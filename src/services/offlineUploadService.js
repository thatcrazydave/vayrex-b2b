const OFFLINE_UPLOADS_KEY = 'vayrex_offline_uploads';
const SYNC_STATUS_KEY = 'vayrex_last_sync';

class OfflineUploadService {
  constructor() {
    this.syncInProgress = false;
    this.initOnlineListener();
  }

  // Save failed upload to localStorage
  saveOfflineUpload(uploadData) {
    try {
      const offlineUploads = this.getOfflineUploads();
      
      const upload = {
        id: Date.now().toString(),
        topic: uploadData.topic,
        fileName: uploadData.fileName,
        questions: uploadData.questions,
        fileBuffer: uploadData.fileBuffer, // Base64 string
        mimeType: uploadData.mimeType,
        timestamp: new Date().toISOString(),
        status: 'pending',
        retryCount: 0
      };

      offlineUploads.push(upload);
      localStorage.setItem(OFFLINE_UPLOADS_KEY, JSON.stringify(offlineUploads));
      
      return upload.id;
    } catch (err) {
      
      // Check if localStorage is full
      if (err.name === 'QuotaExceededError') {
        console.error('  LocalStorage quota exceeded. Clearing old uploads...');
        this.clearOldestUpload();
        return null;
      }
      
      return null;
    }
  }

  // Clear oldest upload to free space
  clearOldestUpload() {
    try {
      const uploads = this.getOfflineUploads();
      if (uploads.length > 0) {
        uploads.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        uploads.shift(); // Remove oldest
        localStorage.setItem(OFFLINE_UPLOADS_KEY, JSON.stringify(uploads));
      }
    } catch (err) {
      console.error('Failed to clear oldest upload:', err);
    }
  }

  // Get all offline uploads
  getOfflineUploads() {
    try {
      const stored = localStorage.getItem(OFFLINE_UPLOADS_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (err) {
      console.error('Failed to retrieve offline uploads:', err);
      return [];
    }
  }

  // Get pending upload count
  getPendingCount() {
    const uploads = this.getOfflineUploads();
    return uploads.filter(u => u.status === 'pending').length;
  }

  // Remove upload from queue
  removeOfflineUpload(uploadId) {
    try {
      const offlineUploads = this.getOfflineUploads();
      const filtered = offlineUploads.filter(u => u.id !== uploadId);
      localStorage.setItem(OFFLINE_UPLOADS_KEY, JSON.stringify(filtered));
      return true;
    } catch (err) {
      console.error('Failed to remove offline upload:', err);
      return false;
    }
  }

  // Update upload status
  updateUploadStatus(uploadId, status, error = null) {
    try {
      const offlineUploads = this.getOfflineUploads();
      const upload = offlineUploads.find(u => u.id === uploadId);
      
      if (upload) {
        upload.status = status;
        upload.lastAttempt = new Date().toISOString();
        if (error) upload.error = error;
        if (status === 'retrying') upload.retryCount += 1;
        
        localStorage.setItem(OFFLINE_UPLOADS_KEY, JSON.stringify(offlineUploads));
      }
    } catch (err) {
      console.error('Failed to update upload status:', err);
    }
  }

  // Sync all pending uploads
  async syncPendingUploads(apiClient) {
    if (this.syncInProgress) {
      return { synced: 0, failed: 0 };
    }

    if (!navigator.onLine) {
      return { synced: 0, failed: 0 };
    }

    this.syncInProgress = true;
    const offlineUploads = this.getOfflineUploads();
    const pending = offlineUploads.filter(u => u.status === 'pending');

    if (pending.length === 0) {
      this.syncInProgress = false;
      return { synced: 0, failed: 0 };
    }

    console.log(`  Syncing ${pending.length} offline uploads...`);

    let synced = 0;
    let failed = 0;

    for (const upload of pending) {
      // Skip if too many retries
      if (upload.retryCount >= 3) {
        this.updateUploadStatus(upload.id, 'failed', 'Max retries exceeded');
        failed++;
        continue;
      }

      try {
        this.updateUploadStatus(upload.id, 'retrying');

        const response = await apiClient.post('/admin/retry-upload', {
          topic: upload.topic,
          fileName: upload.fileName,
          questions: upload.questions,
          fileBuffer: upload.fileBuffer,
          mimeType: upload.mimeType
        });

        if (response.data.success) {
          this.removeOfflineUpload(upload.id);
          synced++;
          console.log(`  Synced: ${upload.topic} (${upload.questions.length} questions)`);
          
          // Emit event for UI update
          window.dispatchEvent(new CustomEvent('uploadSynced', {
            detail: {
              topic: upload.topic,
              questionsAdded: upload.questions.length,
              s3Url: response.data.data.s3Url
            }
          }));
        } else {
          throw new Error(response.data.error?.message || 'Upload failed');
        }

      } catch (err) {
        console.error(`  Failed to sync upload ${upload.id}:`, err.message);
        this.updateUploadStatus(upload.id, 'pending', err.message);
        failed++;
      }

      // Rate limiting between uploads
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Update last sync time
    localStorage.setItem(SYNC_STATUS_KEY, new Date().toISOString());
    this.syncInProgress = false;

    console.log(`  Sync complete: ${synced} succeeded, ${failed} failed`);
    
    // Emit completion event
    window.dispatchEvent(new CustomEvent('syncComplete', {
      detail: { synced, failed }
    }));
    
    return { synced, failed };
  }

  // Initialize online/offline event listeners
  initOnlineListener() {
    window.addEventListener('online', () => {
      console.log('  Connection restored - checking for pending uploads...');
      
      // Delay sync to ensure connection is stable
      setTimeout(() => {
        const pendingCount = this.getPendingCount();
        if (pendingCount > 0) {
          console.log(`Found ${pendingCount} pending uploads`);
          
          // Notify user
          const event = new CustomEvent('offlineUploadsDetected', { 
            detail: { count: pendingCount } 
          });
          window.dispatchEvent(event);
        }
      }, 2000);
    });

    window.addEventListener('offline', () => {
      console.log('  Connection lost - uploads will be queued');
      
      // Notify user
      window.dispatchEvent(new CustomEvent('connectionLost'));
    });
  }

  // Get last sync time
  getLastSyncTime() {
    const lastSync = localStorage.getItem(SYNC_STATUS_KEY);
    return lastSync ? new Date(lastSync) : null;
  }

  // Clear all offline data (use with caution)
  clearAllOfflineUploads() {
    localStorage.removeItem(OFFLINE_UPLOADS_KEY);
    localStorage.removeItem(SYNC_STATUS_KEY);
  }
}

export default new OfflineUploadService();