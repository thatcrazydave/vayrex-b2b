import React, { useState, useEffect } from "react";
import api from "../services/api";
import offlineUploadService from "../services/offlineUploadService";
import { useNetworkStatus } from "../hooks/useNetworkStatus";
import { showToast } from "../utils/toast";
import "../styles/admin.css";

const Upload = () => {
  const [file, setFile] = useState(null);
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [pendingUploads, setPendingUploads] = useState(0);
  const [syncing, setSyncing] = useState(false);
  
  const { isOnline, wasOffline } = useNetworkStatus();

  // Check for pending uploads on mount
  useEffect(() => {
    const count = offlineUploadService.getPendingCount();
    setPendingUploads(count);
  }, []);

  // Listen for network events
  useEffect(() => {
    const handleOfflineDetected = (event) => {
      setPendingUploads(event.detail.count);
      setMessage("Connection restored! " + event.detail.count + " pending upload(s) detected.");
    };

    const handleConnectionLost = () => {
      setMessage("Connection lost. Uploads will be queued offline.");
    };

    const handleUploadSynced = (event) => {
      setMessage("Synced: " + event.detail.topic + " (" + event.detail.questionsAdded + " questions)");
      setPendingUploads(offlineUploadService.getPendingCount());
    };

    const handleSyncComplete = (event) => {
      const { synced, failed } = event.detail;
      if (synced > 0) {
        setMessage("Sync complete: " + synced + " upload(s) synced!");
      }
      if (failed > 0) {
        setMessage(msg => msg + " " + failed + " failed.");
      }
      setPendingUploads(offlineUploadService.getPendingCount());
      setSyncing(false);
    };

    window.addEventListener('offlineUploadsDetected', handleOfflineDetected);
    window.addEventListener('connectionLost', handleConnectionLost);
    window.addEventListener('uploadSynced', handleUploadSynced);
    window.addEventListener('syncComplete', handleSyncComplete);

    return () => {
      window.removeEventListener('offlineUploadsDetected', handleOfflineDetected);
      window.removeEventListener('connectionLost', handleConnectionLost);
      window.removeEventListener('uploadSynced', handleUploadSynced);
      window.removeEventListener('syncComplete', handleSyncComplete);
    };
  }, []);

  // Auto-sync when connection restored
  useEffect(() => {
    if (isOnline && wasOffline && pendingUploads > 0) {
      handleSync();
    }
  }, [isOnline, wasOffline]);

  // Sync pending uploads
  const handleSync = async () => {
    setSyncing(true);
    setMessage("Syncing offline uploads...");

    try {
      await offlineUploadService.syncPendingUploads(api);
    } catch (err) {
      setMessage("Sync failed. Please try again.");
      setSyncing(false);
    }
  };

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    setMessage("");
  };

  const handleTopicChange = (e) => {
    setTopic(e.target.value);
    setMessage("");
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (["dragenter", "dragover"].includes(e.type)) {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      // Only deactivate when leaving the drop zone boundary (not child elements)
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX;
      const y = e.clientY;
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
        setDragActive(false);
      }
    }
  };

  const ALLOWED_EXTENSIONS = /\.(pdf|docx|pptx|txt|jpg|jpeg|png|webp|gif|tif|tiff)$/i;

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFile = e.dataTransfer.files[0];
      // Validate file type
      if (!ALLOWED_EXTENSIONS.test(droppedFile.name)) {
        showToast.error("Unsupported file type. Please upload PDF, DOCX, PPTX, TXT, or image files.");
        return;
      }
      // Validate file size (50MB)
      if (droppedFile.size > 50 * 1024 * 1024) {
        showToast.error("File too large. Maximum size is 50MB.");
        return;
      }
      setFile(droppedFile);
      setMessage("");
    }
  };

  const handleUpload = async () => {
    if (!file || !topic.trim()) {
      setMessage("Please select a file and enter a topic.");
      return;
    }

    setLoading(true);
    setMessage("Processing document...");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("topic", topic.trim());

      // Check if file is an image
      const isImage = /\.(png|jpg|jpeg|webp|gif|tif|tiff)$/i.test(file.name);
      const isPptx = /\.pptx$/i.test(file.name);

      let res;
      
      if (isImage) {
        // Use AI parser for images
        setMessage("Processing image with AI...");
        res = await api.post("/ai/parse-questions", formData, {
          headers: { "Content-Type": "multipart/form-data" },
          timeout: 150000,
          validateStatus: () => true,
        });
      } else if (isPptx) {
        // Use traditional parser for PPTX with longer timeout
        setMessage("Processing PowerPoint presentation...");
        res = await api.post("/upload", formData, {
          headers: { "Content-Type": "multipart/form-data" },
          timeout: 150000,
          validateStatus: () => true,
        });
      } else {
        // Use traditional parser for documents (PDF, DOCX, TXT)
        res = await api.post("/upload", formData, {
          headers: { "Content-Type": "multipart/form-data" },
          timeout: 120000,
          validateStatus: () => true,
        });
        
        // Only fallback to AI if traditional parser found no questions (not for errors)
        if (res.status === 200 && res.data?.success && res.data?.questionsAdded === 0) {
          setMessage("No questions found. This file may not contain extractable questions.");
        }
      }

      // FIX: Check both possible response structures
      const questionsAdded = res.data?.questionsAdded || res.data?.data?.questionsAdded || 0;
      const isSuccess = res.data?.success;

      if (res.status === 403) {
        // Handle limit exceeded
        const errorMsg = res.data?.error?.message || res.data?.message || "Upload limit reached. Please upgrade your plan.";
        showToast.error(errorMsg);
        setMessage("");
      } else if (isSuccess && questionsAdded > 0) {
        showToast.success("Successfully extracted " + questionsAdded + " questions!");
        setFile(null);
        setTopic("");
        setMessage("");
      } else if (isSuccess) {
        showToast.info("Upload succeeded, but no valid questions found in document.");
        setMessage("");
      } else {
        showToast.error(res.data?.error?.message || res.data?.message || "Upload failed.");
        setMessage("");
      }

      setPendingUploads(offlineUploadService.getPendingCount());

    } catch (err) {
      console.error("Upload error:", err);

      if (!navigator.onLine || err.code === 'ERR_NETWORK' || err.message.includes('Network Error')) {
        const questions = await parseFileToQuestions(file);
        
        if (questions && questions.length > 0) {
          const fileBuffer = await fileToBase64(file);
          
          const uploadData = {
            topic: topic.trim(),
            fileName: file.name,
            questions,
            fileBuffer,
            mimeType: file.type
          };

          const uploadId = offlineUploadService.saveOfflineUpload(uploadData);
          
          if (uploadId) {
            setMessage("No internet connection. Upload saved offline (" + questions.length + " questions). Will sync when online.");
            setPendingUploads(offlineUploadService.getPendingCount());
          } else {
            setMessage("Failed to save upload offline. Storage may be full.");
          }
        } else {
          setMessage("Could not parse questions from file for offline storage.");
        }
      } else {
        const errorMsg = err.response?.data?.error?.message || 
                        err.response?.data?.message || 
                        "Upload failed. Please try again.";
        setMessage(errorMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  // Helper: Convert file to base64
  const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = error => reject(error);
    });
  };

  // Helper: Parse file to extract questions (simplified)
  const parseFileToQuestions = async (file) => {
    return [];
  };

  return (
    <div className="upload-container">

      {pendingUploads > 0 && (
        <div className="pending-uploads-banner">
          <span>{pendingUploads} upload(s) pending sync</span>
          <button 
            onClick={handleSync} 
            disabled={syncing || !isOnline}
            className="sync-button"
          >
            {syncing ? "Syncing..." : "Sync Now"}
          </button>
        </div>
      )}

      <div className="admin-upload">
        <div className="upload-header">
          <h2>File Upload</h2>
          <p className="upload-description">
            Upload any academic document - system will automatically choose the best method to extract questions.
          </p>
        </div>

        <div className="upload-form">
          <div className="form-group">
            <label htmlFor="topic">Topic Name</label>
            <input
              id="topic"
              type="text"
              placeholder="Enter topic (e.g., Physics, History)"
              value={topic}
              onChange={handleTopicChange}
              className="topic-input"
              autoComplete="off"
            />
          </div>

          <div className="form-group">
            <label>Upload File</label>
            <div
              className={`file-drop-zone ${dragActive ? "drag-active" : ""} ${
                file ? "has-file" : ""
              }`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              <div className="drop-content">
                <div className="drop-icon">📂</div>
                <div className="drop-text">
                  {file ? (
                    <>
                      <strong>Selected:</strong> {file.name}
                      <br />
                      <small>Click to change file</small>
                    </>
                  ) : (
                    <>
                      <strong>Drag and drop your file here</strong>
                      <br />
                      <small>or click to browse</small>
                    </>
                  )}
                </div>
              </div>
              <input
                type="file"
                accept=".pdf,.docx,.pptx,.ppt,.txt,.jpg,.jpeg,.png,.webp,.gif,.tif,.tiff,.heic,.heif"
                onChange={handleFileChange}
                className="file-input"
              />
            </div>
            <small>
              Supported formats: PDF, DOCX, TXT, JPG, PNG, WEBP, GIF, TIFF (Max size: 50MB)
            </small>
          </div>

          <button
            className="upload-btn"
            onClick={handleUpload}
            disabled={loading || !file || !topic}
          >
            {loading ? (
              <div className="loading-content">
                <div className="spinner"></div>
                Uploading and Processing...
              </div>
            ) : (
              "Upload and Extract"
            )}
          </button>

          {message && (
            <div
              className={`message ${
                message.includes("failed") || 
                message.includes("no valid") ||
                message.includes("no questions") ||
                message.includes("Could not")
                  ? "error"
                  : message.includes("Successfully") || 
                    message.includes("questions!")
                  ? "success"
                  : "info"
              }`}
            >
              {message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Upload;