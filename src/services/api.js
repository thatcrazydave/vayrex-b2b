import axios from "axios";
import { getErrorMessage, CRITICAL_ERRORS } from "../utils/errorHandler";
import { showToast } from "../utils/toast";

const API = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:5002/api",
  timeout: 60000, // 60 second default timeout
  withCredentials: true, // Required for CSRF cookie validation
  headers: {
    "Content-Type": "application/json",
    // Bypass LocalTunnel verification page
    "Bypass-Tunnel-Reminder": "true",
    // Bypass ngrok browser warning page
    "ngrok-skip-browser-warning": "true",
  },
});

//  CSRF Token Management
// Uses stateless HMAC-signed tokens (no cookies needed)
let csrfToken = null;
let csrfPromise = null;

const getCsrfToken = async (force = false) => {
  // Return cached token if available and not forced
  if (csrfToken && !force) {
    return csrfToken;
  }

  // Return existing promise if already fetching
  if (csrfPromise) {
    return csrfPromise;
  }

  // Fetch new token (no cookies/credentials needed for stateless CSRF)
  csrfPromise = axios
    .get(`${import.meta.env.VITE_API_URL || "http://localhost:5002/api"}/csrf-token`, {
      withCredentials: true,
      headers: {
        "Bypass-Tunnel-Reminder": "true",
        "ngrok-skip-browser-warning": "true",
      },
      timeout: 10000, // 10s timeout for CSRF fetch
    })
    .then((response) => {
      csrfToken = response.data.csrfToken;
      csrfPromise = null;

      // Auto-refresh token before it expires (refresh at 90 min mark for 2h token)
      setTimeout(
        () => {
          csrfToken = null; // Clear so next request fetches fresh
        },
        90 * 60 * 1000,
      );

      return csrfToken;
    })
    .catch((err) => {
      console.error("Failed to fetch CSRF token:", err);
      csrfPromise = null;
      throw err;
    });

  return csrfPromise;
};

// Track if we're currently refreshing to prevent multiple refresh attempts
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });

  failedQueue = [];
};

//  Request Interceptor: Add access token and CSRF token
API.interceptors.request.use(
  async (config) => {
    // Add 7-day access token from sessionStorage (pure tab isolation)
    const accessToken =
      sessionStorage.getItem("authToken") || sessionStorage.getItem("accessToken");
    if (accessToken) {
      // Backward compatibility: migrate legacy key if needed
      if (!sessionStorage.getItem("authToken")) {
        sessionStorage.setItem("authToken", accessToken);
      }
      config.headers.Authorization = `Bearer ${accessToken}`;
    }

    // Add CSRF token for state-changing requests
    if (["post", "put", "delete", "patch"].includes(config.method?.toLowerCase())) {
      try {
        const csrfToken = await getCsrfToken();
        config.headers["X-CSRF-Token"] = csrfToken;
      } catch (err) {
        console.error("CSRF token fetch failed:", err);
      }
    }
    return config;
  },
  (error) => Promise.reject(error),
);

//  Response Interceptor: Handle errors and CSRF retries
API.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Enhanced error logging for debugging
    // 401s are not logged at error level here — they will be retried with a
    // fresh access token by the refresh logic below. Only log 401s if the
    // retry itself was already attempted (originalRequest._retry === true),
    // meaning the refresh also failed.
    const is401 = error.response?.status === 401;
    const isRetried = !!originalRequest?._retry;
    if (!is401 || isRetried) {
      const errorDetails = getErrorMessage(error);
      console.error("[API Error]", {
        type: errorDetails.type,
        message: errorDetails.message,
        endpoint: originalRequest?.url,
        method: originalRequest?.method,
        status: error.response?.status,
      });
    }

    // Handle timeout errors specifically
    if (error.code === "ECONNABORTED" && error.message?.includes("timeout")) {
      console.error("[Timeout Error] Request exceeded timeout limit");
      showToast.error("Request timed out. Please check your connection and try again.");
      // Don't retry timeouts automatically
      return Promise.reject(error);
    }

    // Handle network errors (server down)
    if (!error.response) {
      console.error("[Network Error] Cannot reach server");
      showToast.error("Cannot reach server. Please check your connection.");
      return Promise.reject(error);
    }

    // Handle rate limiting (429 = actual rate limits only)
    if (error.response?.status === 429) {
      const serverMessage = error.response.data?.error?.message;
      const retryAfter = error.response.data?.error?.retryAfter;
      const minutes = retryAfter ? Math.ceil(retryAfter / 60) : 1;
      const errorMessage =
        serverMessage ||
        `Rate limit reached. Please wait ${minutes} minute${minutes !== 1 ? "s" : ""} and try again.`;

      console.warn("[Rate Limited]", errorMessage);
      showToast.warning(errorMessage, { autoClose: 5000 });
      return Promise.reject(error);
    }

    // Handle queue/capacity limits (503 = system busy)
    if (error.response?.status === 503) {
      const serverMessage = error.response.data?.error?.message;
      const errorMessage =
        serverMessage || "The server is busy. Please try again in a moment.";

      console.warn("[Service Unavailable]", errorMessage);
      showToast.warning(errorMessage, { autoClose: 5000 });
      return Promise.reject(error);
    }

    // Handle plan/token limit errors (403 with specific codes)
    if (error.response?.status === 403) {
      const errorCode = error.response.data?.error?.code;
      if (
        errorCode === "TOKEN_LIMIT_REACHED" ||
        errorCode === "TOKEN_REQUEST_LIMIT" ||
        errorCode === "UPLOAD_LIMIT_REACHED" ||
        errorCode === "STORAGE_LIMIT_REACHED"
      ) {
        const serverMessage = error.response.data?.error?.message;
        showToast.warning(serverMessage || "Plan limit reached. Consider upgrading.", {
          autoClose: 7000,
        });
        return Promise.reject(error);
      }
      // Let CSRF and other 403s fall through to existing handlers below
    }

    // Handle CSRF token errors (403 Forbidden)
    if (
      error.response?.status === 403 &&
      error.response?.data?.error?.code === "INVALID_CSRF_TOKEN" &&
      !originalRequest._csrfRetry
    ) {
      originalRequest._csrfRetry = true;

      try {
        // Get fresh CSRF token
        const newCsrfToken = await getCsrfToken(true);
        originalRequest.headers["X-CSRF-Token"] = newCsrfToken;
        return API(originalRequest);
      } catch (csrfError) {
        console.error("CSRF retry failed:", csrfError);
        return Promise.reject(error);
      }
    }

    // Handle 401 Unauthorized with token refresh (queue pattern)
    if (error.response?.status === 401 && !originalRequest._retry) {
      // Prevent infinite loop if refresh endpoint itself returns 401
      const isRefreshEndpoint = originalRequest.url?.includes("/auth/refresh");
      if (isRefreshEndpoint) {
        sessionStorage.removeItem("authToken");
        sessionStorage.removeItem("refreshToken");
        sessionStorage.removeItem("user");
        return Promise.reject(error);
      }

      originalRequest._retry = true;

      // If already refreshing, queue this request
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers["Authorization"] = `Bearer ${token}`;
            return API(originalRequest);
          })
          .catch((err) => {
            return Promise.reject(err);
          });
      }

      isRefreshing = true;

      try {
        const refreshToken = sessionStorage.getItem("refreshToken");
        if (!refreshToken) {
          throw new Error("No refresh token");
        }

        const refreshResponse = await axios.post(
          `${import.meta.env.VITE_API_URL || "http://localhost:5002/api"}/auth/refresh`,
          { refreshToken },
          { withCredentials: false },
        );

        if (refreshResponse.data.success) {
          const { accessToken, refreshToken: newRefreshToken } = refreshResponse.data.data;

          sessionStorage.setItem("authToken", accessToken);
          sessionStorage.setItem("refreshToken", newRefreshToken);

          API.defaults.headers.common["Authorization"] = `Bearer ${accessToken}`;
          originalRequest.headers["Authorization"] = `Bearer ${accessToken}`;

          // Process all queued requests with new token
          processQueue(null, accessToken);

          return API.request(originalRequest);
        } else {
          throw new Error("Refresh failed");
        }
      } catch (err) {
        processQueue(err, null);
        sessionStorage.removeItem("authToken");
        sessionStorage.removeItem("refreshToken");
        sessionStorage.removeItem("user");
        return Promise.reject(err);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

//  Export helper to manually refresh CSRF token
export const refreshCsrfToken = () => getCsrfToken(true);

export default API;

// AI helpers
export async function aiChat(messages, context = "academic", model = null) {
  const payload = { messages, context };
  if (model) payload.model = model;
  const res = await API.post("/ai/chat", payload);
  const data = res.data;
  // Treat an empty content field as a failure so callers can show a proper error
  if (!data?.content) {
    const err = new Error("AI returned an empty response. Please try again.");
    err.isEmptyResponse = true;
    throw err;
  }
  return data;
}

/**
 * Start a streaming summarise job.
 * Accepts a File, an array of Files (multi-file), or a string (paste text).
 * Returns { jobId } immediately; use the jobId with the summarize-stream endpoint.
 */
export async function aiSummarizeStart(fileOrTextOrFiles) {
  // Multi-file array
  if (Array.isArray(fileOrTextOrFiles)) {
    const form = new FormData();
    for (const f of fileOrTextOrFiles) {
      form.append("file", f);
    }
    const res = await API.post("/ai/summarize-start", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return res.data;
  }
  // Single file
  if (fileOrTextOrFiles instanceof File) {
    const form = new FormData();
    form.append("file", fileOrTextOrFiles);
    const res = await API.post("/ai/summarize-start", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return res.data;
  }
  // plain text
  const res = await API.post("/ai/summarize-start", { text: fileOrTextOrFiles });
  return res.data;
}

export async function aiSummarize(file) {
  const form = new FormData();
  form.append("file", file);
  const res = await API.post("/ai/summarize", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}

export async function aiSummarizeText(text) {
  const res = await API.post("/ai/summarize", { text });
  return res.data;
}

// ═══════ Summary Session endpoints ═══════

/** List the user's recent summary sessions (last 20, lightweight — no chatHistory) */
export async function getSummarySessions() {
  const res = await API.get("/ai/summary-sessions");
  return res.data; // { success, sessions: [...] }
}

/** Load a full session (with chapters + chatHistory) */
export async function getSummarySession(sessionId) {
  const res = await API.get(`/ai/summary-sessions/${sessionId}`);
  return res.data; // { success, session }
}

/** Auto-save chat messages (append). Expects { messages: [{role, content}] } */
export async function saveSummaryChat(sessionId, messages) {
  const res = await API.put(`/ai/summary-sessions/${sessionId}/chat`, { messages });
  return res.data;
}

/** Save reading position — { lastChapterIdx, lastTab } */
export async function saveSummaryPosition(sessionId, data) {
  const res = await API.put(`/ai/summary-sessions/${sessionId}/position`, data);
  return res.data;
}

/** Save highlights and/or per-chapter notes. Both are optional — send only what changed. */
export async function saveAnnotations(sessionId, { highlights, userNotes } = {}) {
  const res = await API.put(`/ai/summary-sessions/${sessionId}/annotations`, {
    highlights,
    userNotes,
  });
  return res.data;
}

// ═══════ Chat Thread endpoints ═══════

/** List all thread metadata (no messages) for a session. */
export async function getChatThreads(sessionId) {
  const res = await API.get(`/ai/summary-sessions/${sessionId}/threads`);
  return res.data; // { success, threads, activeChatThreadId }
}

/** Create a new chat thread (optionally with a title). Returns the new thread doc. */
export async function createChatThread(sessionId, title = "New Chat") {
  const res = await API.post(`/ai/summary-sessions/${sessionId}/threads`, { title });
  return res.data; // { success, thread }
}

/** Load a single thread with full message history. */
export async function getChatThread(sessionId, threadId) {
  const res = await API.get(`/ai/summary-sessions/${sessionId}/threads/${threadId}`);
  return res.data; // { success, thread }
}

/** Append messages to a thread. Returns auto-updated title when applicable. */
export async function saveChatThreadMessages(sessionId, threadId, messages) {
  const res = await API.put(`/ai/summary-sessions/${sessionId}/threads/${threadId}/messages`, {
    messages,
  });
  return res.data; // { success, title }
}

/** Rename a thread. */
export async function renameChatThread(sessionId, threadId, title) {
  const res = await API.patch(`/ai/summary-sessions/${sessionId}/threads/${threadId}`, {
    title,
  });
  return res.data;
}

/** Delete a thread. */
export async function deleteChatThread(sessionId, threadId) {
  const res = await API.delete(`/ai/summary-sessions/${sessionId}/threads/${threadId}`);
  return res.data;
}

/** Persist which thread is currently open. */
export async function setActiveThread(sessionId, threadId) {
  const res = await API.patch(`/ai/summary-sessions/${sessionId}/active-thread`, { threadId });
  return res.data;
}

/** Delete a summary session (also removes S3 file) */
export async function deleteSummarySession(sessionId) {
  const res = await API.delete(`/ai/summary-sessions/${sessionId}`);
  return res.data;
}

/** Generate a full quiz from a summary session's source file */
export async function generateQuizFromSummary(sessionId, options = {}) {
  const res = await API.post(
    `/ai/summary-sessions/${sessionId}/generate-quiz`,
    {
      count: options.count || 15,
      difficulty: options.difficulty || "medium",
    },
    { timeout: 180000 },
  ); // 3 min for heavy AI generation
  return res.data;
}

/** Quick comprehension check — 5 quick questions from the summary. */
export async function quickCheck(sessionId, options = {}) {
  const res = await API.post(
    `/ai/summary-sessions/${sessionId}/quick-check`,
    {
      chapterIdx: options.chapterIdx ?? null,
      count: options.count || 5,
    },
    { timeout: 120000 },
  );
  return res.data;
}

export async function aiParseQuestions(file, topic) {
  const form = new FormData();
  form.append("file", file);
  form.append("topic", topic);
  const res = await API.post("/ai/parse-questions", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}

// ===== PDF EXPORT =====
export async function exportPDF(topic, options = {}) {
  const res = await API.post(
    "/export/pdf",
    {
      topic,
      difficulty: options.difficulty || null,
      includeAnswers: options.includeAnswers !== false,
      format: options.format || "questions",
      fontSize: options.fontSize || 11,
      fontFamily: options.fontFamily || "Helvetica",
    },
    {
      responseType: "blob",
      timeout: 60000,
    },
  );

  // Trigger download
  const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = options.filename || `${topic}_questions.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);

  return true;
}

// ===== NOTE SUMMARIZATION =====
export async function summarizeNotes(fileOrText, maxSentences = 10) {
  if (typeof fileOrText === "string") {
    const res = await API.post("/notes/summarize", { text: fileOrText, maxSentences });
    return res.data;
  } else {
    const form = new FormData();
    form.append("file", fileOrText);
    form.append("maxSentences", maxSentences);
    const res = await API.post("/notes/summarize", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return res.data;
  }
}

// ===== PAYMENT / SUBSCRIPTION =====
export async function getPlans() {
  const res = await API.get("/plans");
  return res.data;
}

export async function initiateUpgrade(tier, billingCycle = "monthly") {
  const res = await API.post("/user/upgrade", { tier, billingCycle });
  return res.data;
}

export async function verifyPayment(reference) {
  const res = await API.get(`/paystack/verify/${reference}`);
  return res.data;
}

export async function cancelSubscription() {
  const res = await API.post("/user/cancel-subscription");
  return res.data;
}

// ===== BULK UPLOAD =====
export async function bulkUpload(files, topic) {
  const form = new FormData();
  form.append("topic", topic);
  for (const file of files) {
    form.append("files", file);
  }
  const res = await API.post("/upload/bulk", form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 300000, // 5 min timeout for bulk
  });
  return res.data;
}

export async function getBulkUploadStatus(jobId) {
  const res = await API.get(`/upload/bulk/${jobId}`);
  return res.data;
}

// ===== DELETE SINGLE FILE =====
export async function deleteSingleFile(topic, filename) {
  const res = await API.delete(
    `/uploads/${encodeURIComponent(topic)}/${encodeURIComponent(filename)}`,
  );
  return res.data;
}

// ═══════ Course Outline endpoints ═══════

/** Pre-flight: detect if input is a course outline and parse structure */
export async function parseCourseOutline(fileOrText) {
  // Accept a single File, an array of Files, or a text string
  if (
    fileOrText instanceof File ||
    (Array.isArray(fileOrText) && fileOrText[0] instanceof File)
  ) {
    const form = new FormData();
    const files = Array.isArray(fileOrText) ? fileOrText : [fileOrText];
    for (const f of files) {
      form.append("file", f);
    }
    const res = await API.post("/ai/course-outline/parse", form, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 120000,
    });
    return res.data;
  }
  // plain text
  const res = await API.post(
    "/ai/course-outline/parse",
    { text: fileOrText },
    { timeout: 60000 },
  );
  return res.data;
}

/** Start outline generation; returns { jobId, sessionId } */
export async function generateCourseOutlineNotes(payload) {
  const res = await API.post("/ai/course-outline/generate", payload, { timeout: 30000 });
  return res.data;
}

/**
 * Subscribe to the course outline generation stream (reuses summary stream endpoint).
 * Returns an AbortController so the caller can cancel.
 */
export function subscribeToCourseOutlineStream(
  jobId,
  { onTitle, onChapterOverview, onSubChapter, onChapter, onComplete, onError },
) {
  const controller = new AbortController();
  const token = sessionStorage.getItem("authToken");
  const baseURL = import.meta.env.VITE_API_URL || "http://localhost:5002/api";

  fetch(`${baseURL}/ai/summarize-stream/${encodeURIComponent(jobId)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "ngrok-skip-browser-warning": "true",
      "Bypass-Tunnel-Reminder": "true",
    },
    credentials: "include",
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok || !response.body) {
        onError?.("Stream connection failed");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        let value, done;
        try {
          ({ value, done } = await reader.read());
        } catch (readErr) {
          if (readErr.name !== "AbortError") onError?.(readErr.message || "Stream read error");
          break;
        }
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const event = JSON.parse(trimmed);
            if (event.type === "title") onTitle?.(event.title);
            else if (event.type === "chapter_overview") onChapterOverview?.(event);
            else if (event.type === "sub_chapter") onSubChapter?.(event);
            else if (event.type === "chapter") onChapter?.(event.chapter);
            else if (event.type === "complete") onComplete?.(event);
            else if (event.type === "error") onError?.(event.message);
          } catch {
            /* skip malformed line */
          }
        }
      }
    })
    .catch((err) => {
      if (err.name !== "AbortError") {
        onError?.(err.message || "Stream error");
      }
    });

  return controller;
}

/** Export course outline notes as PDF */
export async function exportCourseOutlineNotes(sessionId, options = {}) {
  const res = await API.post(
    `/ai/course-outline/${sessionId}/export`,
    {
      fontSize: options.fontSize || 11,
      fontFamily: options.fontFamily || "Helvetica",
    },
    {
      responseType: "blob",
      timeout: 120000,
    },
  );

  // Trigger download
  const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = options.filename || "course-notes.pdf";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);

  return true;
}

/** Export file summary as PDF */
export async function exportSummaryPDF(sessionId, options = {}) {
  const res = await API.post(
    `/ai/summary/${sessionId}/export`,
    {
      fontSize: options.fontSize || 11,
      fontFamily: options.fontFamily || "Helvetica",
    },
    {
      responseType: "blob",
      timeout: 120000,
    },
  );

  const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = options.filename || "study-summary.pdf";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);

  return true;
}

/** Retry only failed sub-chapters in a course outline session */
export async function retryCourseOutlineFailures(sessionId) {
  const res = await API.post(`/ai/course-outline/${sessionId}/retry`);
  return res.data;
}
