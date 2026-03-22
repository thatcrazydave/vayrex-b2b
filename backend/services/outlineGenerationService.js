const aiService = require('./aiService');
const Logger = require('../logger');
const SummarySession = require('../models/SummarySession');

/**
 * ╔═══════════════════════════════════════════════════════════════════╗
 * ║  Outline Generation Service — Sequential + Parallel Orchestrator  ║
 * ║                                                                    ║
 * ║  Chapters: SEQUENTIAL (Ch1 → Ch2 → Ch3)                          ║
 * ║  Sub-chapters within a chapter: PARALLEL (worker pool)            ║
 * ║  Micro-batch pre-classification: Topic nature of NEXT chapter     ║
 * ║    runs in parallel with current chapter's generation.            ║
 * ║  Model routing: Short outlines → gpt-5.1, Long → gpt-5-mini.    ║
 * ║  Mirrors batchGenerationService patterns with retry + backoff.    ║
 * ╚═══════════════════════════════════════════════════════════════════╝
 */

const SUB_CHAPTER_CONCURRENCY = Math.min(Math.max(Number(process.env.OUTLINE_SUB_CHAPTER_CONCURRENCY) || 4, 1), 10);
const MAX_RETRIES = 2;

/**
 * Generate a single sub-chapter with retry logic.
 * Now accepts topicClassification and outlineModel for adaptive prompting.
 * @returns {Promise<{ success: boolean, number: string, title: string, content: string, tokensUsed: number }>}
 */
async function generateSubChapterWithRetry(params, retryCount = 0) {
  const { chapterTitle, subChapterTitle, chapterNumber, subChapterNumber, depthTier, courseName, topicClassification, outlineModel } = params;
  const number = `${chapterNumber}.${subChapterNumber}`;

  try {
    const result = await aiService.generateSubChapterContent({
      chapterTitle,
      subChapterTitle,
      chapterNumber,
      subChapterNumber,
      depthTier,
      courseName,
      topicClassification,
      outlineModel
    });

    if (!result.success) {
      throw new Error(result.error || 'AI generation returned failure');
    }

    return {
      success: true,
      number,
      title: subChapterTitle,
      content: result.content,
      tokensUsed: result.tokensUsed
    };
  } catch (error) {
    const errorStr = (error.message || '').toString();
    const isRetryable = ['429', 'ECONNRESET', 'ETIMEDOUT', 'rate_limit'].some(code => errorStr.includes(code));

    if (isRetryable && retryCount < MAX_RETRIES) {
      const backoffMs = Math.pow(2, retryCount) * 2000; // 2s, 4s
      Logger.info(`Retrying sub-chapter ${number} in ${backoffMs}ms`, {
        attempt: retryCount + 1,
        error: errorStr.substring(0, 100)
      });
      await new Promise(resolve => setTimeout(resolve, backoffMs));
      return generateSubChapterWithRetry(params, retryCount + 1);
    }

    Logger.error(`Sub-chapter ${number} failed after retries`, { error: errorStr });
    return {
      success: false,
      number,
      title: subChapterTitle,
      content: `*This section could not be generated. Please try regenerating.*`,
      tokensUsed: 0
    };
  }
}

/**
 * Generate all chapters and sub-chapters for a course outline session.
 *
 * ARCHITECTURE:
 * - Chapters are processed SEQUENTIALLY (Ch1 → Ch2 → Ch3)
 * - Sub-chapters within a chapter are processed IN PARALLEL (worker pool)
 * - MICRO-BATCH PRE-CLASSIFICATION: While current chapter generates,
 *   the NEXT chapter's topic classification runs in a background slot.
 *   When a chapter has N sub-topics, the worker pool is N+1: N workers
 *   for sub-chapters + 1 worker for next chapter's classification.
 *   When a chapter is standalone (no sub-topics), classification for
 *   the next chapter runs concurrently with the standalone lesson.
 * - MODEL ROUTING: Outline size determines model selection.
 *
 * @param {Object} params
 * @param {string} params.sessionId          — MongoDB session ID
 * @param {Array}  params.chapters           — Parsed chapter map from courseOutlineService
 * @param {string} params.courseName         — Course name
 * @param {string} params.depthTier          — 'full' | 'standard' | 'condensed'
 * @param {Function} params.onProgress       — Callback({ type, chapterNumber, subChapterNumber, data })
 * @returns {Promise<{ totalTokensUsed: number, successCount: number, failureCount: number }>}
 */
async function generateOutlineContent({ sessionId, chapters, courseName, depthTier, onProgress }) {
  let totalTokensUsed = 0;
  let successCount = 0;
  let failureCount = 0;

  // ── Model routing based on outline size ──
  const totalSubTopics = chapters.reduce((sum, ch) => sum + (ch.subTopics?.length || 0), 0);
  const outlineModel = aiService.constructor.selectOutlineModel(chapters.length, totalSubTopics);

  Logger.info('Starting outline generation', {
    sessionId,
    chapters: chapters.length,
    totalSubTopics,
    depthTier,
    courseName,
    outlineModel
  });

  // ── Pre-classify Chapter 1 before the loop starts ──
  // This ensures the very first chapter also has its classification ready.
  let nextClassificationPromise = null;
  let classificationCache = {}; // chapterIndex → classification result

  if (chapters.length > 0) {
    const firstChapter = chapters[0];
    nextClassificationPromise = aiService.classifyTopicNature({
      chapterTitle: firstChapter.chapterTitle,
      subTopics: firstChapter.subTopics || [],
      courseName
    }).then(result => {
      classificationCache[0] = result;
      Logger.info('Pre-classified chapter 1 topic', {
        chapterTitle: firstChapter.chapterTitle,
        topicNature: result.topicNature,
        structureStrategy: result.structureStrategy
      });
      return result;
    }).catch(err => {
      Logger.warn('Pre-classification for chapter 1 failed', { error: err.message });
      classificationCache[0] = null;
      return null;
    });
  }

  // Wait for chapter 1's classification before entering the loop
  await nextClassificationPromise;

  // Process chapters SEQUENTIALLY
  for (let chIdx = 0; chIdx < chapters.length; chIdx++) {
    const chapter = chapters[chIdx];
    const chapterNumber = chapter.weekNumber || (chIdx + 1);
    const chapterTitle = chapter.chapterTitle;

    // ── Retrieve this chapter's pre-computed classification ──
    const topicClassification = classificationCache[chIdx] || null;

    Logger.info(`Generating chapter ${chapterNumber}: ${chapterTitle}`, {
      sessionId,
      topicNature: topicClassification?.topicNature || 'unknown',
      structureStrategy: topicClassification?.structureStrategy || 'unknown'
    });

    // ── Launch micro-batch: pre-classify NEXT chapter while this one generates ──
    // This runs as a background promise — does NOT block current chapter generation.
    let nextChapterClassificationPromise = null;
    const nextIdx = chIdx + 1;
    if (nextIdx < chapters.length && !classificationCache[nextIdx]) {
      const nextChapter = chapters[nextIdx];
      nextChapterClassificationPromise = aiService.classifyTopicNature({
        chapterTitle: nextChapter.chapterTitle,
        subTopics: nextChapter.subTopics || [],
        courseName
      }).then(result => {
        classificationCache[nextIdx] = result;
        Logger.info(`Pre-classified chapter ${nextIdx + 1} topic (micro-batch)`, {
          chapterTitle: nextChapter.chapterTitle,
          topicNature: result.topicNature,
          structureStrategy: result.structureStrategy
        });
        return result;
      }).catch(err => {
        Logger.warn(`Pre-classification for chapter ${nextIdx + 1} failed`, { error: err.message });
        classificationCache[nextIdx] = null;
        return null;
      });
    }

    // ── Step 1: Generate chapter overview (X.0) — BLOCKING ──
    let overviewContent = '';
    try {
      const overviewResult = await aiService.generateChapterOverview({
        chapterTitle,
        subTopics: chapter.subTopics,
        depthTier,
        courseName,
        chapterNumber,
        // When a chapter has no sub-topics (bare TOC), generate a standalone full lesson
        // instead of a short intro overview, to compensate for the missing sub-chapter depth.
        isStandaloneChapter: chapter.subTopics.length === 0,
        topicClassification,
        outlineModel
      });

      overviewContent = overviewResult.success
        ? overviewResult.content
        : `*Overview could not be generated for this chapter.*`;
      totalTokensUsed += overviewResult.tokensUsed || 0;

      // Persist overview to DB immediately
      await SummarySession.updateOne(
        { _id: sessionId, 'chapters.id': chapterNumber },
        { $set: { 'chapters.$.overview': overviewContent } }
      );

      // Emit progress
      if (onProgress) {
        onProgress({
          type: 'chapter_overview',
          chapterNumber,
          chapterTitle,
          overview: overviewContent,
          totalChapters: chapters.length
        });
      }
    } catch (err) {
      Logger.error(`Chapter ${chapterNumber} overview failed`, { error: err.message });
      overviewContent = '*Overview generation failed.*';
      failureCount++;
    }

    // ── Step 2: Generate sub-chapters IN PARALLEL (worker pool) ──
    // The worker pool size is N+1 when there's a next chapter to pre-classify:
    // N workers handle sub-chapters, the +1 slot is used by the classification
    // promise that's already running in the background.
    if (chapter.subTopics.length > 0) {
      const subChapterQueue = chapter.subTopics.map((subTopic, subIdx) => ({
        chapterTitle,
        subChapterTitle: subTopic,
        chapterNumber,
        subChapterNumber: subIdx + 1,
        depthTier,
        courseName,
        topicClassification,
        outlineModel
      }));

      const subChapterResults = [];

      // Worker pool — same pattern as batchGenerationService
      // The next-chapter classification is already running as a background promise
      // alongside these workers, effectively giving us N+1 concurrency
      const queue = [...subChapterQueue];
      const workers = Array(Math.min(SUB_CHAPTER_CONCURRENCY, queue.length)).fill(null).map(async () => {
        while (queue.length > 0) {
          const job = queue.shift();
          if (!job) break;
          const result = await generateSubChapterWithRetry(job);
          subChapterResults.push(result);

          totalTokensUsed += result.tokensUsed || 0;
          if (result.success) successCount++;
          else failureCount++;

          // Persist sub-chapter to DB immediately
          const subChapterDoc = {
            number: result.number,
            title: result.title,
            content: result.content,
            status: result.success ? 'complete' : 'failed'
          };

          try {
            await SummarySession.updateOne(
              { _id: sessionId, 'chapters.id': chapterNumber },
              { $push: { 'chapters.$.subChapters': subChapterDoc } }
            );
          } catch (dbErr) {
            Logger.error('Failed to persist sub-chapter', { error: dbErr.message, number: result.number });
          }

          // Emit progress per sub-chapter completion
          if (onProgress) {
            onProgress({
              type: 'sub_chapter',
              chapterNumber,
              subChapterNumber: job.subChapterNumber,
              subChapterTitle: result.title,
              success: result.success,
              content: result.content,
              totalSubChapters: chapter.subTopics.length,
              completedSubChapters: subChapterResults.length,
              totalChapters: chapters.length,
              currentChapter: chIdx + 1
            });
          }
        }
      });

      await Promise.all(workers);

      // Sort sub-chapters in DB by number (workers complete in arbitrary order)
      try {
        const sess = await SummarySession.findById(sessionId);
        if (sess) {
          const chDoc = sess.chapters.find(c => c.id === chapterNumber);
          if (chDoc && chDoc.subChapters?.length > 1) {
            chDoc.subChapters.sort((a, b) => {
              const aParts = a.number.split('.').map(Number);
              const bParts = b.number.split('.').map(Number);
              return aParts[0] - bParts[0] || aParts[1] - bParts[1];
            });
            await sess.save();
          }
        }
      } catch (sortErr) {
        Logger.warn('Failed to sort sub-chapters', { error: sortErr.message, chapterNumber });
      }

      Logger.info(`Chapter ${chapterNumber} complete`, {
        sessionId,
        subChaptersTotal: chapter.subTopics.length,
        subChaptersSuccess: subChapterResults.filter(r => r.success).length,
        subChaptersFailed: subChapterResults.filter(r => !r.success).length
      });
    }

    // ── Ensure next chapter's classification has finished before we loop ──
    // By this point the micro-batch has had the entire duration of this chapter's
    // generation to complete — this await is nearly always instant.
    if (nextChapterClassificationPromise) {
      await nextChapterClassificationPromise;
    }

    // Emit chapter-complete event
    if (onProgress) {
      onProgress({
        type: 'chapter_complete',
        chapterNumber,
        chapterTitle,
        totalChapters: chapters.length,
        completedChapters: chIdx + 1
      });
    }
  }

  // ── Finalize session status ──
  const finalStatus = failureCount === 0 ? 'complete' : 'partial';
  try {
    await SummarySession.updateOne(
      { _id: sessionId },
      { status: finalStatus, totalExpectedChunks: chapters.length }
    );
  } catch (err) {
    Logger.error('Failed to update session status', { error: err.message, sessionId });
  }

  Logger.info('Outline generation complete', {
    sessionId,
    finalStatus,
    totalTokensUsed,
    successCount,
    failureCount
  });

  return { totalTokensUsed, successCount, failureCount, finalStatus };
}

/**
 * Retry ONLY failed sub-chapters in a session — never touches completed ones.
 *
 * @param {Object} params
 * @param {string} params.sessionId    — MongoDB session ID
 * @param {Function} params.onProgress — Callback({ type, chapterNumber, subChapterNumber, ... })
 * @returns {Promise<{ totalTokensUsed, retriedCount, successCount, failureCount }>}
 */
async function retryFailedSubChapters({ sessionId, onProgress }) {
  const session = await SummarySession.findById(sessionId);
  if (!session) throw new Error('Session not found');

  let totalTokensUsed = 0;
  let retriedCount = 0;
  let successCount = 0;
  let failureCount = 0;

  Logger.info('Starting failed sub-chapter retry', { sessionId, chapters: session.chapters.length });

  for (const chapter of session.chapters) {
    const failedSubs = (chapter.subChapters || []).filter(sc => sc.status === 'failed');
    if (failedSubs.length === 0) continue;

    Logger.info(`Retrying ${failedSubs.length} failed sub-chapters in chapter ${chapter.id}`, { sessionId });

    const retryQueue = failedSubs.map(sc => {
      const parts = sc.number.split('.').map(Number);
      return {
        chapterTitle: chapter.title,
        subChapterTitle: sc.title,
        chapterNumber: parts[0] || chapter.id,
        subChapterNumber: parts[1] || 1,
        depthTier: session.depthTier || 'standard',
        courseName: session.courseName || ''
      };
    });

    // Run retries with the same worker pool pattern
    const queue = [...retryQueue];
    const workers = Array(Math.min(SUB_CHAPTER_CONCURRENCY, queue.length)).fill(null).map(async () => {
      while (queue.length > 0) {
        const job = queue.shift();
        if (!job) break;
        retriedCount++;
        const result = await generateSubChapterWithRetry(job);

        totalTokensUsed += result.tokensUsed || 0;
        if (result.success) successCount++;
        else failureCount++;

        // Update the existing sub-chapter in-place (not push — it already exists)
        try {
          await SummarySession.updateOne(
            { _id: sessionId, 'chapters.id': job.chapterNumber },
            {
              $set: {
                'chapters.$.subChapters.$[sc].content': result.content,
                'chapters.$.subChapters.$[sc].status': result.success ? 'complete' : 'failed'
              }
            },
            { arrayFilters: [{ 'sc.number': result.number }] }
          );
        } catch (dbErr) {
          Logger.error('Failed to update retried sub-chapter', { error: dbErr.message, number: result.number });
        }

        if (onProgress) {
          onProgress({
            type: 'sub_chapter_retry',
            chapterNumber: job.chapterNumber,
            subChapterNumber: job.subChapterNumber,
            subChapterTitle: result.title,
            success: result.success,
            content: result.content
          });
        }
      }
    });

    await Promise.all(workers);
  }

  // Re-evaluate session status
  const updatedSession = await SummarySession.findById(sessionId);
  const hasAnyFailed = updatedSession.chapters.some(ch =>
    ch.subChapters?.some(sc => sc.status === 'failed')
  );
  const newStatus = hasAnyFailed ? 'partial' : 'complete';

  await SummarySession.updateOne({ _id: sessionId }, { status: newStatus });

  Logger.info('Failed sub-chapter retry complete', {
    sessionId, retriedCount, successCount, failureCount, newStatus
  });

  return { totalTokensUsed, retriedCount, successCount, failureCount, finalStatus: newStatus };
}

module.exports = {
  generateOutlineContent,
  generateSubChapterWithRetry,
  retryFailedSubChapters
};
