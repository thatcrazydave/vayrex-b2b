const { Worker, UnrecoverableError } = require('bullmq');
const mongoose = require('mongoose');
const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { redisConnection, decrementUserActiveJobs } = require('../services/taskQueue');
const { getRedisClient } = require('../redisClient');
const { parsePptxFile } = require('../parsers/pptxParser');
const batchGenerationService = require('../services/batchGenerationService');
const aiService = require('../services/aiService');
const coherenceService = require('../services/coherenceService');
const questionDensityService = require('../services/questionDensityService');
const { extractBundle, calculateProportionalBudget, buildCombinedTextPool } = require('../services/multiFileService');
const batchProcessingService = require('../services/batchProcessingService');
const localOcrService = require('../services/localOcrService');
const Question = require("../models/questions");
const PdfLibrary = require("../models/PdfLibrary");
const User = require("../models/User");
const Logger = require("../logger");
const Validators = require("../validators");

const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const S3_BUCKET = process.env.S3_BUCKET_NAME;

const worker = new Worker('background-tasks', async (job) => {
    const { userId, topic, difficulty, questionsCount, text, s3FileKey, fileType, fileName, contentHash,
        isMultiFile, s3BundleKey, files: filesMetadata, combinedContentHash } = job.data;

    Logger.info(`Worker processing job ${job.id}`, { userId, topic, jobId: job.id, isMultiFile: !!isMultiFile });

    try {
        // 0. Circuit Breaker Check
        if (await aiService._isCircuitOpen()) {
            throw new Error('DELAYED_BY_CIRCUIT_BREAKER');
        }

        // ╔═══════════════════════════════════════════════════════════╗
        // ║  MULTI-FILE PROCESSING PATH                               ║
        // ╚═══════════════════════════════════════════════════════════╝
        if (isMultiFile && s3BundleKey && filesMetadata) {
            return await _processMultiFileJob(job);
        }

        // ╔═══════════════════════════════════════════════════════════╗
        // ║  SINGLE-FILE PROCESSING PATH (original — unchanged)       ║
        // ╚═══════════════════════════════════════════════════════════╝

        let fileBuffer = null;
        let type = fileType;
        let pptxMetadata = null;

        // 1. Fetch content if needed
        if (s3FileKey) {
            Logger.info(`Fetching file from S3: ${s3FileKey}`);
            const command = new GetObjectCommand({
                Bucket: S3_BUCKET,
                Key: s3FileKey,
            });
            const response = await s3Client.send(command);
            const chunks = [];
            for await (const chunk of response.Body) {
                chunks.push(chunk);
            }
            fileBuffer = Buffer.concat(chunks);
            Logger.info(`S3 fetch complete`, { s3FileKey, bufferSizeBytes: fileBuffer.length, jobId: job.id });
        } else if (text) {
            fileBuffer = Buffer.from(text);
            type = '.txt';
            Logger.info(`Job ${job.id}: Using text input path`, { textLength: text.length, topic });
        } else {
            throw new Error('No content provided (text or s3FileKey)');
        }

        if (type === '.pptx') {
            try {
                const pptxData = await parsePptxFile(fileBuffer);
                pptxMetadata = {
                    totalSlides: pptxData.metadata?.totalSlides,
                    totalImages: pptxData.metadata?.totalImages,
                    slides: Array.isArray(pptxData.slides)
                        ? pptxData.slides.map(slide => ({
                            slideNumber: slide.slideNumber,
                            text: slide.text,
                            tables: slide.tables
                        }))
                        : []
                };
                Logger.info(`PPTX metadata extracted`, {
                    totalSlides: pptxData.metadata?.totalSlides,
                    totalImages: pptxData.metadata?.totalImages,
                    jobId: job.id
                });
            } catch (pptxErr) {
                Logger.warn('PPTX metadata extraction failed', { error: pptxErr.message });
            }
        }

        await job.updateProgress({ percent: 10, partialQuestions: [] });

        let accumulatedQuestions = [];
        // 2. Process via batch generation service
        const batchResult = await batchGenerationService.processBatchedFile({
            fileBuffer,
            fileType: type,
            topic,
            difficulty,
            questionsCount,
            userId: new mongoose.Types.ObjectId(userId),
            contentHash, // SHA256 of raw file bytes — drives global cache key
            useMixedTypes: true,
            onProgress: (data) => {
                const p = 10 + Math.floor((data.totalProcessed / data.totalBatches) * 80);
                if (data.questions && data.questions.length > 0) {
                    accumulatedQuestions = [...accumulatedQuestions, ...data.questions];
                }
                job.updateProgress({
                    percent: p,
                    partialQuestions: accumulatedQuestions
                });
            }
        });

        const questions = batchResult.allQuestions || [];

        if (questions.length === 0) {
            Logger.error(`Job ${job.id} failed: No questions generated by AI service`, {
                userId,
                topic,
                fileType: type,
                fileName: fileName || 'unknown'
            });
            throw new Error('No questions generated');
        }

        await job.updateProgress({ percent: 90, partialQuestions: accumulatedQuestions });

        // 3. Clean and Save to DB (Idempotent & Atomic-like)
        // Normalize questionType — AI sometimes returns non-standard names
        const _normalizeQType = (raw) => {
            if (!raw) return 'multiple-choice';
            const t = String(raw).toLowerCase().replace(/[_\s]+/g, '-');
            if (t.includes('fill') || t.includes('blank') || t.includes('gap') || t.includes('cloze')) return 'fill-in-blank';
            if (t.includes('theory') || t.includes('short') || t.includes('essay') || t.includes('open') || t.includes('explain') || t.includes('long') || t.includes('descriptive')) return 'theory';
            return 'multiple-choice';
        };

        const cleanedQuestions = questions
            .map((q, index) => {
                const qType = _normalizeQType(q.questionType);
                const base = {
                    questionText: (q.questionText || '').trim(),
                    questionNumber: String(index + 1),
                    subPart: null,
                    questionType: qType,
                    explanation: (q.explanation || '').trim(),
                    difficulty: difficulty.toLowerCase(),
                    userId: new mongoose.Types.ObjectId(userId),
                    topic,
                    sourceFile: fileName || 'batch_generated',
                    batchId: q.batchId || `job-${job.id}`
                };
                if (qType === 'fill-in-blank') {
                    return { ...base, options: [], correctAnswer: null, blankAnswer: (q.blankAnswer || '').trim() };
                } else if (qType === 'theory') {
                    return { ...base, options: [], correctAnswer: null, modelAnswer: (q.modelAnswer || '').trim() };
                } else {
                    const rawAnswer = q.correctAnswer;
                    const parsedAnswer = typeof rawAnswer === 'number' ? rawAnswer
                        : (typeof rawAnswer === 'string' && /^\d+$/.test(rawAnswer.trim())) ? parseInt(rawAnswer.trim(), 10)
                        : null;
                    return {
                        ...base,
                        options: Array.isArray(q.options) ? q.options.map(o => String(o).trim()).filter(o => o) : [],
                        correctAnswer: parsedAnswer
                    };
                }
            })
            .filter(q => {
                if (q.questionText.length < 10) return false;
                if (q.questionType === 'fill-in-blank') return !!q.blankAnswer;
                if (q.questionType === 'theory') return !!q.modelAnswer;
                return q.options.length >= 2 && q.correctAnswer !== null;
            });

        Logger.info(`Questions cleaned`, {
            jobId: job.id,
            rawCount: questions.length,
            cleanedCount: cleanedQuestions.length,
            droppedCount: questions.length - cleanedQuestions.length
        });

        if (cleanedQuestions.length === 0) {
            Logger.error(`Job ${job.id} failed: No valid questions after cleaning`, {
                userId,
                topic,
                cleanedCount: cleanedQuestions.length,
                originalCount: questions.length
            });
            throw new Error('No valid questions after cleaning');
        }

        // Detect if environment supports transactions (Replica Set required)
        const client = mongoose.connection.getClient();
        const isReplicaSet = client.topology?.description?.type?.includes('ReplicaSet') ||
            client.topology?.type === 'replica-set';

        Logger.info(`Transaction support detected`, {
            jobId: job.id,
            isReplicaSet,
            mode: isReplicaSet ? 'transactions enabled' : 'standalone — no transactions'
        });

        let session = null;
        try {
            if (isReplicaSet) {
                try {
                    session = await mongoose.startSession();
                    session.startTransaction();
                } catch (sErr) {
                    Logger.warn('Failed to start transaction session, falling back', { error: sErr.message });
                    session = null;
                }
            }

            // --- Idempotent Persistence Block ---
            const result = await _performIdempotentPersistence({
                job, userId, topic, difficulty, cleanedQuestions, s3FileKey, fileName, pptxMetadata, session, totalTokensUsed: batchResult.totalTokensUsed || 0
            });

            if (session) {
                await session.commitTransaction();
                Logger.info(`Transaction committed for job ${job.id}`);
            }

            await job.updateProgress({ percent: 100, partialQuestions: accumulatedQuestions });
            return result;

        } catch (dbError) {
            if (session) await session.abortTransaction();

            // Fallback for standalone Mongo if detection failed or session threw later
            if (dbError.message.includes('Transaction numbers are only allowed on a replica set')) {
                Logger.warn('Environment does not support transactions. Retrying without session.');
                return await _performIdempotentPersistence({
                    job, userId, topic, difficulty, cleanedQuestions, s3FileKey, fileName, pptxMetadata, session: null, totalTokensUsed: batchResult.totalTokensUsed || 0
                });
            }
            throw dbError;
        } finally {
            if (session) session.endSession();
        }

    } catch (error) {
        if (error.message === 'DELAYED_BY_CIRCUIT_BREAKER') {
            Logger.warn(`Job ${job.id} postponed: AI Circuit Breaker is OPEN`);
            await job.moveToDelayed(Date.now() + 120000);
            // Return a sentinel so BullMQ marks the job as "completed" but
            // we skip decrementing the user's active-job counter since the
            // job will re-enter the queue when the delay expires.
            return { __circuitBreakerDelayed: true };
        }
        Logger.error(`Worker error in job ${job.id}:`, { error: error.message, stack: error.stack });
        // Permanent failures (e.g. S3 upload never landed) should not be retried
        if (error instanceof UnrecoverableError) throw error;
        throw error; // BullMQ will handle retries based on backoff
    }
}, {
    connection: redisConnection,
    concurrency: Number(process.env.WORKER_CONCURRENCY) || 8,
    lockDuration: Number(process.env.WORKER_LOCK_DURATION) || 300000, // 5 minutes — AI batch jobs can run long
    limiter: {
        max: 15,
        duration: 1000
    },
});

worker.on('completed', (job) => {
    // Skip decrement for circuit-breaker-delayed jobs (they will re-run)
    if (job?.returnvalue?.__circuitBreakerDelayed) {
        Logger.info(`Job ${job.id} delayed by circuit breaker — skipping active job decrement`);
        return;
    }
    Logger.info(`Job ${job.id} completed successfully`);
    if (job?.data?.userId) {
        decrementUserActiveJobs(job.data.userId).catch(err => {
            Logger.warn('Failed to decrement active jobs on completion', { error: err.message });
        });
    }
});

worker.on('failed', (job, err) => {
    Logger.error(`Job ${job.id} failed:`, { error: err.message, reason: err.failedReason });
    if (job?.data?.userId) {
        decrementUserActiveJobs(job.data.userId).catch(decErr => {
            Logger.warn('Failed to decrement active jobs on failure', { error: decErr.message });
        });
    }
});

module.exports = worker;

// ╔═══════════════════════════════════════════════════════════════════╗
// ║  MULTI-FILE PROCESSING PIPELINE                                   ║
// ╚═══════════════════════════════════════════════════════════════════╝

async function _processMultiFileJob(job) {
    const { userId, topic, difficulty, questionsCount, s3BundleKey, files: filesMetadata, combinedContentHash } = job.data;
    const jobTag = `multi-file-job-${job.id}`;

    Logger.info(`[${jobTag}] Starting multi-file processing`, {
        fileCount: filesMetadata.length,
        topic,
        questionsCount,
        userId
    });

    // ── Step 1: Fetch ZIP bundle from S3 (with retry — upload may still be in
    //   progress when the worker starts, since the route fire-and-forgot it).
    //   We check a Redis signal first so we can fail-fast if the upload itself
    //   failed rather than burning through all retry attempts.
    Logger.info(`[${jobTag}] Fetching ZIP bundle from S3`, { s3BundleKey });
    const _bundleRedisKey = `bundle_upload:${s3BundleKey}`;
    const S3_FETCH_MAX_ATTEMPTS = 8;
    const S3_FETCH_RETRY_DELAYS_MS = [5000, 10000, 15000, 20000, 30000, 45000, 60000];
    let bundleBuffer = null;
    for (let attempt = 1; attempt <= S3_FETCH_MAX_ATTEMPTS; attempt++) {
        // Check Redis signal — fail-fast if the server-side upload already failed
        try {
            const _redis = getRedisClient();
            if (_redis) {
                const uploadStatus = await _redis.get(_bundleRedisKey);
                if (uploadStatus === 'failed') {
                    throw new UnrecoverableError('Bundle upload failed on the server side — cannot proceed');
                }
            }
        } catch (redisErr) {
            if (redisErr instanceof UnrecoverableError) throw redisErr;
            // Redis unavailable — ignore and fall through to S3 probe
        }

        try {
            const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: s3BundleKey });
            const response = await s3Client.send(command);
            const chunks = [];
            for await (const chunk of response.Body) { chunks.push(chunk); }
            bundleBuffer = Buffer.concat(chunks);
            Logger.info(`[${jobTag}] S3 bundle fetched (attempt ${attempt})`, { bundleSizeBytes: bundleBuffer.length });
            break;
        } catch (err) {
            if (err instanceof UnrecoverableError) throw err;
            const notReady = err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404;
            if (notReady && attempt < S3_FETCH_MAX_ATTEMPTS) {
                const delay = S3_FETCH_RETRY_DELAYS_MS[attempt - 1] || 60000;
                Logger.warn(`[${jobTag}] Bundle not in S3 yet, retrying in ${delay / 1000}s (attempt ${attempt}/${S3_FETCH_MAX_ATTEMPTS})`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw err;
            }
        }
    }
    if (!bundleBuffer) throw new UnrecoverableError('Failed to fetch bundle from S3 after all retry attempts');

    await job.updateProgress({ percent: 5, partialQuestions: [] });

    // ── Step 2: Extract individual files from ZIP ──
    const extractedFiles = extractBundle(bundleBuffer);
    Logger.info(`[${jobTag}] Extracted ${extractedFiles.length} files from bundle`);

    // Match extracted files with metadata (for extension/mime info)
    const filesWithMeta = extractedFiles.map(ef => {
        const meta = filesMetadata.find(m => m.fileName === ef.fileName) || {};
        return {
            fileName: ef.fileName,
            data: ef.data,
            extension: meta.extension || '.' + ef.fileName.split('.').pop().toLowerCase(),
            mimeType: meta.mimeType || 'application/octet-stream',
            contentHash: meta.contentHash || null,
            size: meta.size || ef.data.length
        };
    });

    await job.updateProgress({ percent: 10, partialQuestions: [] });

    // ── Step 3: Extract text from each file ──
    Logger.info(`[${jobTag}] Extracting text from ${filesWithMeta.length} files`);
    const filesWithText = [];
    let pptxMetadataMap = {};

    for (const file of filesWithMeta) {
        try {
            let extractedText = '';

            if (file.extension === '.txt') {
                extractedText = file.data.toString('utf8');
            } else if (file.extension === '.pptx' || file.extension === '.ppt') {
                const pptxData = await parsePptxFile(file.data);
                extractedText = await batchProcessingService.extractFullContent(file.data, file.extension);
                pptxMetadataMap[file.fileName] = {
                    totalSlides: pptxData.metadata?.totalSlides,
                    totalImages: pptxData.metadata?.totalImages,
                    slides: Array.isArray(pptxData.slides)
                        ? pptxData.slides.map(s => ({ slideNumber: s.slideNumber, text: s.text, tables: s.tables }))
                        : []
                };
            } else {
                // PDF, DOCX — use extractFullContent from batchProcessingService
                extractedText = await batchProcessingService.extractFullContent(file.data, file.extension);
            }

            // Clean text
            const { cleanedText } = localOcrService.cleanText(extractedText, `${jobTag}_${file.fileName}`);

            filesWithText.push({
                fileName: file.fileName,
                text: cleanedText,
                textLength: cleanedText.length,
                extension: file.extension,
                contentHash: file.contentHash,
                data: file.data,
                mimeType: file.mimeType,
                size: file.size
            });

            Logger.info(`[${jobTag}] Text extracted from ${file.fileName}`, {
                textLength: cleanedText.length,
                extension: file.extension
            });
        } catch (extractErr) {
            Logger.error(`[${jobTag}] Failed to extract text from ${file.fileName}`, {
                error: extractErr.message,
                extension: file.extension
            });
            // Continue with other files — don't fail the entire job for one file
        }
    }

    if (filesWithText.length === 0) {
        throw new Error('Failed to extract text from any uploaded file');
    }

    await job.updateProgress({ percent: 25, partialQuestions: [] });

    // ── Step 4: Coherence analysis (informational only — NEVER blocks) ──
    Logger.info(`[${jobTag}] Running coherence analysis`);
    const coherenceResult = await coherenceService.analyzeCoherence(filesWithText);
    Logger.info(`[${jobTag}] Coherence analysis complete`, {
        coherenceLevel: coherenceResult.coherenceLevel,
        overallScore: coherenceResult.overallScore,
        outlierCount: (coherenceResult.outlierFiles || []).length,
        message: coherenceResult.coherenceMessage
    });

    // ── Step 5: Question density / past-paper detection ──
    Logger.info(`[${jobTag}] Running question density scoring`);
    const densityResult = questionDensityService.detectStyleAnchor(filesWithText);
    Logger.info(`[${jobTag}] Density scoring complete`, {
        hasStyleAnchor: densityResult.isStyleAnchor,
        anchorFile: densityResult.anchorFile,
        anchorScore: densityResult.anchorScore
    });

    await job.updateProgress({ percent: 30, partialQuestions: [] });

    // ── Step 6: Build proportional question budget ──
    const budgets = calculateProportionalBudget(filesWithText, questionsCount);
    Logger.info(`[${jobTag}] Proportional budgets`, {
        budgets: budgets.map(b => ({ file: b.fileName, questions: b.questionBudget, pct: b.percentage }))
    });

    // ── Step 7: Pool text with file markers ──
    const { combinedText, totalLength } = buildCombinedTextPool(filesWithText);
    Logger.info(`[${jobTag}] Combined text pool built`, {
        totalLength,
        fileCount: filesWithText.length
    });

    await job.updateProgress({ percent: 35, partialQuestions: [] });

    // ── Step 8: Generate questions via batch service (pooled text as .combined) ──
    let accumulatedQuestions = [];

    const batchResult = await batchGenerationService.processBatchedFile({
        fileBuffer: Buffer.from(combinedText),
        fileType: '.txt',  // Pooled text treated as plain text
        topic,
        difficulty,
        questionsCount,
        userId: new mongoose.Types.ObjectId(userId),
        contentHash: combinedContentHash,
        useMixedTypes: true,
        styleExemplars: densityResult.isStyleAnchor ? densityResult.anchorText : null,
        coherenceContext: coherenceResult.coherenceLevel !== 'all_coherent' ? {
            level: coherenceResult.coherenceLevel,
            fileNames: filesWithText.map(f => f.fileName)
        } : null,
        onProgress: (data) => {
            const p = 35 + Math.floor((data.totalProcessed / data.totalBatches) * 50);
            if (data.questions && data.questions.length > 0) {
                accumulatedQuestions = [...accumulatedQuestions, ...data.questions];
            }
            job.updateProgress({ percent: p, partialQuestions: accumulatedQuestions });
        }
    });

    const questions = batchResult.allQuestions || [];

    if (questions.length === 0) {
        Logger.error(`[${jobTag}] No questions generated from pooled content`, {
            userId, topic, fileCount: filesWithText.length
        });
        throw new Error('No questions generated from combined files');
    }

    await job.updateProgress({ percent: 90, partialQuestions: accumulatedQuestions });

    // ── Step 9: Clean & Save questions ──
    // Normalize questionType — AI sometimes returns non-standard names
    const _normalizeQType = (raw) => {
        if (!raw) return 'multiple-choice';
        const t = String(raw).toLowerCase().replace(/[_\s]+/g, '-');
        if (t.includes('fill') || t.includes('blank') || t.includes('gap') || t.includes('cloze')) return 'fill-in-blank';
        if (t.includes('theory') || t.includes('short') || t.includes('essay') || t.includes('open') || t.includes('explain') || t.includes('long') || t.includes('descriptive')) return 'theory';
        return 'multiple-choice';
    };

    const cleanedQuestions = questions
        .map((q, index) => {
            const qType = _normalizeQType(q.questionType);
            const base = {
                questionText: (q.questionText || '').trim(),
                questionNumber: String(index + 1),
                subPart: null,
                questionType: qType,
                explanation: (q.explanation || '').trim(),
                difficulty: difficulty.toLowerCase(),
                userId: new mongoose.Types.ObjectId(userId),
                topic,
                sourceFile: `combined_${filesWithText.length}_files`,
                batchId: q.batchId || `job-${job.id}`
            };
            if (qType === 'fill-in-blank') {
                return { ...base, options: [], correctAnswer: null, blankAnswer: (q.blankAnswer || '').trim() };
            } else if (qType === 'theory') {
                return { ...base, options: [], correctAnswer: null, modelAnswer: (q.modelAnswer || '').trim() };
            } else {
                const rawAnswer = q.correctAnswer;
                const parsedAnswer = typeof rawAnswer === 'number' ? rawAnswer
                    : (typeof rawAnswer === 'string' && /^\d+$/.test(rawAnswer.trim())) ? parseInt(rawAnswer.trim(), 10)
                    : null;
                return {
                    ...base,
                    options: Array.isArray(q.options) ? q.options.map(o => String(o).trim()).filter(o => o) : [],
                    correctAnswer: parsedAnswer
                };
            }
        })
        .filter(q => {
            if (q.questionText.length < 10) return false;
            if (q.questionType === 'fill-in-blank') return !!q.blankAnswer;
            if (q.questionType === 'theory') return !!q.modelAnswer;
            return q.options.length >= 2 && q.correctAnswer !== null;
        });

    Logger.info(`[${jobTag}] Questions cleaned`, {
        rawCount: questions.length,
        cleanedCount: cleanedQuestions.length
    });

    if (cleanedQuestions.length === 0) {
        throw new Error('No valid questions after cleaning');
    }

    // ── Step 10: Persist (idempotent) ──
    const client = mongoose.connection.getClient();
    const isReplicaSet = client.topology?.description?.type?.includes('ReplicaSet') ||
        client.topology?.type === 'replica-set';

    let session = null;
    try {
        if (isReplicaSet) {
            try {
                session = await mongoose.startSession();
                session.startTransaction();
            } catch (sErr) {
                Logger.warn('Failed to start transaction for multi-file, falling back', { error: sErr.message });
                session = null;
            }
        }

        const result = await _performMultiFilePersistence({
            job, userId, topic, difficulty, cleanedQuestions,
            s3BundleKey, filesWithText, pptxMetadataMap,
            coherenceResult, densityResult, budgets,
            session, totalTokensUsed: batchResult.totalTokensUsed || 0
        });

        if (session) {
            await session.commitTransaction();
            Logger.info(`[${jobTag}] Transaction committed`);
        }

        await job.updateProgress({ percent: 100, partialQuestions: accumulatedQuestions });
        return result;

    } catch (dbError) {
        if (session) await session.abortTransaction();

        if (dbError.message.includes('Transaction numbers are only allowed on a replica set')) {
            Logger.warn('[multi-file] Retrying without session');
            return await _performMultiFilePersistence({
                job, userId, topic, difficulty, cleanedQuestions,
                s3BundleKey, filesWithText, pptxMetadataMap,
                coherenceResult, densityResult, budgets,
                session: null, totalTokensUsed: batchResult.totalTokensUsed || 0
            });
        }
        throw dbError;
    } finally {
        if (session) session.endSession();
    }
}

// ── Multi-File Persistence Helper ──
async function _performMultiFilePersistence({
    job, userId, topic, difficulty, cleanedQuestions,
    s3BundleKey, filesWithText, pptxMetadataMap,
    coherenceResult, densityResult, budgets,
    session, totalTokensUsed = 0
}) {
    const jobTag = `job-${job.id}`;

    // 1. Check/Insert Questions (idempotent)
    const existingQuestions = await Question.find({ batchId: `job-${job.id}` }).session(session);
    let savedQuestions;
    if (existingQuestions.length > 0) {
        Logger.info(`Idempotency: Questions already exist for ${jobTag}`);
        savedQuestions = existingQuestions;
    } else {
        savedQuestions = await Question.insertMany(cleanedQuestions, { session });
        Logger.info(`[DB SUCCESS] Saved ${savedQuestions.length} questions for multi-file ${jobTag}`);

        // Update usage stats
        try {
            const usageInc = { 'usage.questionsGenerated': savedQuestions.length };
            if (totalTokensUsed > 0) usageInc['usage.tokensUsedThisMonth'] = totalTokensUsed;
            await User.findByIdAndUpdate(userId, { $inc: usageInc });
        } catch (usageErr) {
            Logger.warn('Failed to update usage stats (multi-file)', { error: usageErr.message });
        }
    }

    // 2. S3 backup of questions
    const s3BackupKey = await _saveBackupToS3(userId, topic, cleanedQuestions);

    // 3. Create a SINGLE PdfLibrary record for the entire multi-file upload.
    //    The entry uses the user-supplied topic as its display name / fileName
    //    so dashboard shows one card (e.g. "yin-202") instead of one per file.
    const hasAnswers = cleanedQuestions.some(q => q.correctAnswer !== null);
    const sourceFileNames = filesWithText.map(f => f.fileName);

    const updateFields = {
        numberOfQuestions: savedQuestions.length,
        hasAnswers,
        fileName: topic,                       // user-supplied name, NOT individual file names
        topic,
        s3BundleKey,
        jobId: `job-${job.id}`,
        coherenceMetadata: {
            coherenceLevel: coherenceResult.coherenceLevel,
            overallScore: coherenceResult.overallScore,
            isOutlier: false,
            questionBudget: savedQuestions.length,
            isStyleAnchor: !!densityResult.isStyleAnchor,
            sourceFiles: sourceFileNames          // keep audit trail of which files were bundled
        }
    };

    if (s3BackupKey) updateFields.s3BackupKey = s3BackupKey;

    // Merge any PPTX metadata from the first file that has it (informational only)
    const firstPptx = filesWithText.find(f => pptxMetadataMap[f.fileName]);
    if (firstPptx) updateFields.pptxMetadata = pptxMetadataMap[firstPptx.fileName];

    await PdfLibrary.findOneAndUpdate(
        { userId: new mongoose.Types.ObjectId(userId), topic, jobId: `job-${job.id}` },
        {
            $set: updateFields,
            $setOnInsert: { uploadedAt: new Date() }
        },
        { upsert: true, new: true, session }
    );

    Logger.info(`[DB SUCCESS] Single PdfLibrary entry for multi-file upload`, {
        jobId: `job-${job.id}`,
        topic,
        questionCount: savedQuestions.length,
        sourceFiles: sourceFileNames
    });

    return {
        success: true,
        questionsCount: savedQuestions.length,
        topic,
        isMultiFile: true,
        fileCount: filesWithText.length,
        coherence: {
            level: coherenceResult.coherenceLevel,
            score: coherenceResult.overallScore,
            message: coherenceResult.coherenceMessage
        },
        styleAnchor: densityResult.isStyleAnchor ? {
            file: densityResult.anchorFile,
            score: densityResult.anchorScore
        } : null
    };
}

// --- Helper: S3 question backup (non-critical, mirrors saveBackupToS3 in server.js) ---
async function _saveBackupToS3(userId, topic, questions) {
    try {
        const backupKey = `question_backups/${userId}/${topic}_${Date.now()}.json`;
        await s3Client.send(new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: backupKey,
            Body: JSON.stringify(questions, null, 2),
            ContentType: 'application/json'
        }));
        Logger.info(`[S3 SUCCESS] Question backup saved`, { backupKey });
        return backupKey;
    } catch (err) {
        Logger.warn('Question backup to S3 failed (non-critical)', { error: err.message });
        return null;
    }
}

// --- Helper for Idempotent Persistence ---
async function _performIdempotentPersistence({
    job, userId, topic, difficulty, cleanedQuestions, s3FileKey, fileName, pptxMetadata, session, totalTokensUsed = 0
}) {
    // 1. Check/Insert Questions
    const existingQuestions = await Question.find({ batchId: `job-${job.id}` }).session(session);
    let savedQuestions;
    if (existingQuestions.length > 0) {
        Logger.info(`Idempotency: Questions already exist for job ${job.id}`);
        savedQuestions = existingQuestions;
    } else {
        savedQuestions = await Question.insertMany(cleanedQuestions, { session });
        Logger.info(`[DB SUCCESS] Saved ${savedQuestions.length} new questions to Database for job ${job.id}`);

        // Atomically update user's questionsGenerated count AND tokensUsedThisMonth (only on first insert, not retries)
        try {
            const usageInc = { 'usage.questionsGenerated': savedQuestions.length };
            if (totalTokensUsed > 0) {
                usageInc['usage.tokensUsedThisMonth'] = totalTokensUsed;
            }
            await User.findByIdAndUpdate(userId, { $inc: usageInc });
            Logger.info(`[DB SUCCESS] Updated usage stats for user ${userId}`, {
                questionsGenerated: savedQuestions.length,
                tokensUsed: totalTokensUsed
            });
        } catch (usageErr) {
            // Non-critical — questions are saved, just log the failure
            Logger.warn('Failed to update usage stats', { error: usageErr.message, userId });
        }
    }

    // 2. Update PdfLibrary
    if (s3FileKey) {
        const hasAnswers = cleanedQuestions.some(q => q.correctAnswer !== null);
        const s3BackupKey = await _saveBackupToS3(userId, topic, cleanedQuestions);
        const updateFields = {
            numberOfQuestions: savedQuestions.length,
            hasAnswers,
            fileName: fileName || s3FileKey.split('_').pop() || 'upload',
            topic
        };
        if (s3BackupKey) updateFields.s3BackupKey = s3BackupKey;
        if (pptxMetadata) {
            updateFields.pptxMetadata = pptxMetadata;
        }

        await PdfLibrary.findOneAndUpdate(
            { userId: new mongoose.Types.ObjectId(userId), s3FileKey },
            {
                $set: updateFields,
                $setOnInsert: {
                    uploadedAt: new Date()
                }
            },
            { upsert: true, new: true, session }
        );
        Logger.info(`[DB SUCCESS] Updated/Created PdfLibrary entry for S3 key: ${s3FileKey}`);
    }

    return {
        success: true,
        questionsCount: savedQuestions.length,
        topic
    };
};

