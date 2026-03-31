const batchProcessingService = require('./batchProcessingService');
const aiService = require('./aiService');
const localOcrService = require('./localOcrService');
const Logger = require('../logger');

function _computeQuestionTypeSplit(total) {
  if (total < 5) return { mcq: total, fillInGap: 0, theory: 0 };
  if (total < 10) {
    const fillInGap = Math.round(total * 0.25);
    return { mcq: total - fillInGap, fillInGap, theory: 0 };
  }
  const mcq = Math.round(total * 0.60);
  const fillInGap = Math.round(total * 0.25);
  const theory = total - mcq - fillInGap;
  return { mcq, fillInGap, theory };
}

/**
 * Process a single batch: extract content → generate questions
 * @param {Object} params
 * @returns {Promise<Object>} { batchId, questions, contentLength, processingTime }
 */
async function processSingleBatch(params) {
  const { batchSpec, fileBuffer, fileType, topic, difficulty, questionsCount, userId, preExtractedContent = null, model = 'gpt-5-mini-2025-08-07', contentHash = null, styleExemplars = null, coherenceContext = null, useMixedTypes = false } = params;
  const batchStartTime = Date.now();

  try {
    Logger.info(`Processing batch ${batchSpec.batchId}/${batchSpec.totalBatches}`, {
      fileType,
      startItem: batchSpec.startItem,
      endItem: batchSpec.endItem,
      userId
    });

    // Step 1: Extract content for this batch
    let batchContent = '';

    if (preExtractedContent) {
      // Use pre-extracted content (monolithic files like PDF/DOCX)
      if (fileType === '.pdf' || fileType === '.docx') {
        const fullLen = preExtractedContent.length;
        const totalItems = batchSpec.totalBatches;
        const startChar = Math.floor(((batchSpec.startItem - 1) / batchSpec.totalItemsCount) * fullLen);
        const endChar = Math.floor((batchSpec.endItem / batchSpec.totalItemsCount) * fullLen);
        batchContent = preExtractedContent.substring(startChar, endChar);
      } else {
        batchContent = preExtractedContent;
      }
    } else {
      // Dynamic extraction (PPTX or first-time monolithic)
      if (fileType === '.pptx' || fileType === '.ppt') {
        batchContent = await batchProcessingService.extractPptxBatch(
          fileBuffer,
          batchSpec.startItem,
          batchSpec.endItem
        );
      } else if (fileType === '.pdf') {
        batchContent = await batchProcessingService.extractPdfBatch(
          fileBuffer,
          batchSpec.startItem,
          batchSpec.endItem
        );
      } else if (fileType === '.docx') {
        batchContent = await batchProcessingService.extractDocxBatch(
          fileBuffer,
          batchSpec.startItem,
          batchSpec.endItem
        );
      } else {
        throw new Error(`Unsupported file type: ${fileType}`);
      }
    }

    const contentLength = batchContent.length;
    Logger.info(`Batch ${batchSpec.batchId} content extracted`, {
      contentLength,
      startItem: batchSpec.startItem,
      endItem: batchSpec.endItem
    });

    // Step 1.5: Clean text with local OCR service (reduces AI tokens by ~40%)
    const { cleanedText, metrics: ocrMetrics } = localOcrService.cleanText(batchContent, `batch_${batchSpec.batchId}`);
    batchContent = cleanedText;

    Logger.info(`Batch ${batchSpec.batchId} text cleaned`, {
      originalLength: ocrMetrics.originalLength,
      cleanedLength: ocrMetrics.cleanedLength,
      reductionPercent: ocrMetrics.reductionPercent,
      timeMs: ocrMetrics.timeMs
    });

    // Step 2: Validate content
    if (!batchContent || batchContent.trim().length < 50) {
      Logger.warn(`Batch ${batchSpec.batchId} has insufficient content`, {
        contentLength,
        required: 50
      });
      return {
        batchId: batchSpec.batchId,
        questions: [],
        contentLength,
        processingTime: Date.now() - batchStartTime,
        status: 'insufficient_content',
        error: 'Content too short for question generation'
      };
    }

    // Step 3: Generate questions for this batch
    const batchQuestionCount = Math.ceil(questionsCount / batchSpec.totalBatches);

    Logger.info(`Generating questions for batch ${batchSpec.batchId}`, {
      questionsCount: batchQuestionCount,
      topic,
      difficulty,
      model
    });

    let questions = [];
    let tokensUsed = 0;
    if (useMixedTypes) {
      const split = _computeQuestionTypeSplit(batchQuestionCount);
      questions = await aiService.generateMixedQuestions({
        text: batchContent,
        count: batchQuestionCount,
        difficulty,
        topic,
        split
      });
      if (!Array.isArray(questions)) questions = [];
    } else {
      const aiResult = await aiService.generateQuestions({
        text: batchContent,
        topic,
        difficulty,
        count: batchQuestionCount,
        model,
        contentHash,                        // SHA256 of raw file bytes — global cache key
        batchId: batchSpec.batchId,         // Which batch (identifies the content chunk)
        totalBatches: batchSpec.totalBatches, // Total batches (determines chunk boundaries)
        styleExemplars,                     // Past question exemplars for style injection (multi-file)
        coherenceContext                    // Coherence metadata for prompt framing (multi-file)
      });

      if (!aiResult.success) {
        Logger.warn(`Batch ${batchSpec.batchId} AI generation failed`, {
          error: aiResult.error?.code
        });
        return {
          batchId: batchSpec.batchId,
          questions: [],
          contentLength,
          processingTime: Date.now() - batchStartTime,
          status: 'generation_failed',
          error: aiResult.error?.message || 'AI generation failed'
        };
      }
      questions = aiResult.questions || [];
      tokensUsed = aiResult.tokensUsed || 0;
    }

    Logger.info(`Batch ${batchSpec.batchId} processing complete`, {
      questionsGenerated: questions.length,
      processingTimeMs: Date.now() - batchStartTime
    });

    return {
      batchId: batchSpec.batchId,
      questions,
      tokensUsed,
      contentLength,
      processingTime: Date.now() - batchStartTime,
      status: 'success'
    };
  } catch (error) {
    Logger.error(`Error processing batch ${batchSpec.batchId}:`, {
      error: error.message,
      fileType,
      batchSpec
    });

    return {
      batchId: batchSpec.batchId,
      questions: [],
      contentLength: 0,
      processingTime: Date.now() - batchStartTime,
      status: 'error',
      error: error.message
    };
  }
}

/**
 * Process file with batch parallelization
 * @param {Object} params
 * @returns {Promise<Object>} { allQuestions, batchMetadata, totalProcessingTime }
 */
const IMAGE_MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

async function processBatchedFile(params) {
  let { fileBuffer, fileType, topic, difficulty, questionsCount, userId, onProgress = null, contentHash = null, styleExemplars = null, coherenceContext = null, useMixedTypes = false } = params;
  const startTime = Date.now();

  try {
    // ── Image files: extract text via GPT-5.1 Vision then treat as .txt ──
    if (IMAGE_MIME[fileType]) {
      Logger.info(`Image file detected (${fileType}), extracting text via Vision API`, { topic });
      const base64 = fileBuffer.toString('base64');
      const mime = IMAGE_MIME[fileType];
      try {
        const visionResp = await aiService.openai.chat.completions.create({
          model: 'gpt-5.1-2025-11-13',
          max_completion_tokens: 4096,
          reasoning: { effort: 'high' },
          messages: [{
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Extract and transcribe ALL text visible in this image as accurately as possible. Preserve headings, bullet points, tables, equations, and any other structured content. Output plain text only — no commentary.'
              },
              {
                type: 'image_url',
                image_url: { url: `data:${mime};base64,${base64}`, detail: 'high' }
              }
            ]
          }]
        });
        const extracted = visionResp.choices?.[0]?.message?.content || '';
        Logger.info(`Vision API text extraction complete`, { charCount: extracted.length, topic });
        if (extracted.trim().length < 30) {
          throw new Error('Vision API returned insufficient text from image');
        }
        // Re-enter pipeline as plain text
        fileBuffer = Buffer.from(extracted, 'utf8');
        fileType = '.txt';
      } catch (visionErr) {
        Logger.error('Vision API image extraction failed', { error: visionErr.message });
        throw new Error(`Could not extract text from image: ${visionErr.message}`);
      }
    }

    // Handle raw text input — apply semantic slicing for large text pools
    if (fileType === '.txt') {
      let preExtractedContent = fileBuffer.toString('utf8');

      // Apply semantic slicing to large text (e.g. multi-file combined pools)
      // Without this, 800K+ chars would exceed OpenAI's context window and abort
      if (preExtractedContent.length > 25000) {
        Logger.info(`Applying semantic slicing to .txt content`, {
          originalLength: preExtractedContent.length,
          topic
        });
        const batchSpecs = batchProcessingService.generateTokenBatchSpecsFromContent(
          preExtractedContent.length, fileType, questionsCount
        );
        preExtractedContent = batchProcessingService.sliceRepresentativeContext(
          preExtractedContent, topic, Math.max(batchSpecs.length, 5)
        );
        Logger.info(`Semantic slicing complete for .txt`, {
          slicedLength: preExtractedContent.length,
          batchCount: batchSpecs.length
        });
      }

      // Use token-based batching so each chunk stays within model context limits
      const txtBatchSpecs = batchProcessingService.generateTokenBatchSpecsFromContent(
        preExtractedContent.length, fileType, questionsCount
      );

      const specsWithTotal = txtBatchSpecs.map(spec => ({
        ...spec,
        totalBatches: txtBatchSpecs.length
      }));

      Logger.info(`Processing .txt in ${specsWithTotal.length} batch(es)`, {
        contentLength: preExtractedContent.length,
        batchCount: specsWithTotal.length
      });

      const CONCURRENCY_LIMIT = Number(process.env.BATCH_CONCURRENCY_LIMIT) || 8;
      const batchResults = [];
      let totalTokensUsed = 0;

      for (let i = 0; i < specsWithTotal.length; i += CONCURRENCY_LIMIT) {
        const chunk = specsWithTotal.slice(i, i + CONCURRENCY_LIMIT);
        const chunkPromises = chunk.map(batchSpec => {
          // Slice proportional content for this batch
          const fullLen = preExtractedContent.length;
          const startChar = Math.floor(((batchSpec.startItem - 1) / batchSpec.totalItemsCount) * fullLen);
          const endChar = Math.floor((batchSpec.endItem / batchSpec.totalItemsCount) * fullLen);
          const batchText = preExtractedContent.substring(startChar, endChar);

          return processSingleBatchWithRetry({
            batchSpec,
            fileBuffer,
            fileType,
            topic,
            difficulty,
            questionsCount,
            userId,
            preExtractedContent: batchText,
            model: 'gpt-5-mini-2025-08-07',
            contentHash,
            styleExemplars,
            coherenceContext,
            useMixedTypes
          });
        });

        const results = await Promise.allSettled(chunkPromises);
        for (const r of results) {
          if (r.status === 'fulfilled') {
            batchResults.push(r.value);
            totalTokensUsed += r.value.tokensUsed || 0;
          }
        }

        if (onProgress) {
          const totalProcessed = Math.min(i + CONCURRENCY_LIMIT, specsWithTotal.length);
          const questions = batchResults.flatMap(r => r.questions || []);
          onProgress({ totalProcessed, totalBatches: specsWithTotal.length, questions });
        }
      }

      const allQuestions = batchResults.flatMap(r => r.questions || []);
      return {
        allQuestions,
        batchMetadata: batchResults.map(r => ({
          batchId: r.batchId,
          questionsGenerated: (r.questions || []).length,
          contentLength: r.contentLength,
          processingTimeMs: r.processingTime,
          status: r.status,
          error: r.error || null
        })),
        totalContentLength: preExtractedContent.length,
        totalProcessingTime: Date.now() - startTime,
        totalTokensUsed,
        successCount: batchResults.filter(r => r.status === 'success').length,
        failureCount: batchResults.filter(r => r.status !== 'success').length
      };
    }

    Logger.info(`Extracting full content for ${fileType} once...`);
    let fullText = await batchProcessingService.extractFullContent(fileBuffer, fileType);

    let batchSpecs = batchProcessingService.generateTokenBatchSpecsFromContent(fullText.length, fileType, questionsCount);

    // Step 3 optimization: Semantic slicing if document is very large
    let preExtractedContent = null;
    if (fullText.length > 25000) {
      Logger.info(`Applying semantic slicing to ${fullText.length} chars`);
      preExtractedContent = batchProcessingService.sliceRepresentativeContext(fullText, topic, batchSpecs.length);
    } else {
      preExtractedContent = fullText;
    }
    Logger.info(`Final context size: ${preExtractedContent.length} chars`);
    fullText = null;

    // Add totalBatches to each spec for questions calculation
    const specsWithTotal = batchSpecs.map(spec => ({
      ...spec,
      totalBatches: batchSpecs.length
    }));

    Logger.info(`Generated ${batchSpecs.length} batch(es) for processing`, {
      batchCount: specsWithTotal.length,
      fileType
    });

    // Step 4: Process all batches with CONCURRENCY LIMIT (all batches fire simultaneously)
    // Using gpt-5-mini for drafting (Step 4)
    const CONCURRENCY_LIMIT = Number(process.env.BATCH_CONCURRENCY_LIMIT) || 8;
    const batchResults = [];
    const queue = [...specsWithTotal];

    // Simple worker pool
    const workers = Array(Math.min(CONCURRENCY_LIMIT, queue.length)).fill(null).map(async () => {
      while (queue.length > 0) {
        const spec = queue.shift();
        const result = await processSingleBatchWithRetry({
          batchSpec: spec,
          fileBuffer,
          fileType,
          topic,
          difficulty,
          questionsCount,
          userId,
          preExtractedContent,
          model: 'gpt-5-mini-2025-08-07', // Explicitly use smaller model for draft generation
          contentHash,
          styleExemplars,
          coherenceContext,
          useMixedTypes
        });

        batchResults.push(result);

        // Step 5 optimization: Callback for partial results
        if (onProgress && result.status === 'success') {
          onProgress({
            batchId: result.batchId,
            questions: result.questions,
            totalProcessed: batchResults.length,
            totalBatches: specsWithTotal.length
          });
        }
      }
    });

    try {
      await Promise.all(workers);
    } finally {
      queue.length = 0;
    }

    Logger.info('All batches processed', {
      batchCount: batchResults.length,
      successCount: batchResults.filter(r => r.status === 'success').length
    });

    // Step 4: Combine results (Sort by batchId to maintain document order)
    batchResults.sort((a, b) => a.batchId - b.batchId);

    let allQuestions = [];
    const batchMetadata = [];
    let totalContentLength = 0;
    let successBatches = 0;
    let failedBatches = 0;
    let totalTokensUsed = 0;

    for (const result of batchResults) {
      batchMetadata.push({
        batchId: result.batchId,
        questionsGenerated: result.questions.length,
        contentLength: result.contentLength,
        processingTimeMs: result.processingTime,
        status: result.status,
        error: result.error || null
      });

      totalContentLength += result.contentLength;

      if (result.status === 'success') {
        allQuestions.push(...result.questions);
        totalTokensUsed += (result.tokensUsed || 0);
        successBatches++;
      } else {
        failedBatches++;
      }
    }

    if (questionsCount && allQuestions.length > questionsCount) {
      allQuestions = allQuestions.slice(0, questionsCount);
    }

    const totalTime = Date.now() - startTime;

    Logger.info('Batch processing complete', {
      totalBatches: batchResults.length,
      successBatches,
      failedBatches,
      totalQuestions: allQuestions.length,
      totalTime
    });

    return {
      allQuestions,
      batchMetadata,
      totalContentLength,
      totalTokensUsed,
      totalProcessingTime: totalTime,
      successCount: successBatches,
      failureCount: failedBatches
    };
  } catch (error) {
    Logger.error('Error in batch processing:', { error: error.message });
    throw error;
  }
}

/**
 * Process a single batch with retry logic
 */
async function processSingleBatchWithRetry(params, retryCount = 0) {
  const MAX_RETRIES = 2;
  const result = await processSingleBatch(params);

  // Retry only on rate limits or connection errors
  const retryableCodes = ['429', 'ECONNRESET', 'ETIMEDOUT', 'AI_GENERATION_FAILED'];
  const isRetryableStatus = result.status === 'generation_failed' || result.status === 'error';
  const errorStr = (result.error || '').toString();
  const isRetryableError = retryableCodes.some(code => errorStr.includes(code));
  const isRetryable = isRetryableStatus && isRetryableError;

  if (isRetryable && retryCount < MAX_RETRIES) {
    const backoffTime = Math.pow(2, retryCount) * 2000; // 2s, 4s backoff
    Logger.info(`Retrying batch ${params.batchSpec.batchId} in ${backoffTime}ms...`, {
      attempt: retryCount + 1,
      error: result.error
    });

    await new Promise(resolve => setTimeout(resolve, backoffTime));
    return processSingleBatchWithRetry(params, retryCount + 1);
  }

  return result;
}

module.exports = {
  processSingleBatch,
  processBatchedFile,
  processSingleBatchWithRetry,
  _computeQuestionTypeSplit
};
