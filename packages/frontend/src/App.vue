<script setup lang="ts">
import { ref } from 'vue'

const fileInput = ref<HTMLInputElement | null>(null)
const status = ref<string>('')
const statusType = ref<'info' | 'success' | 'error'>('info')
const isUploading = ref(false)

// Configuration - these will be set via environment variables
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://1fd9v08g3m.execute-api.ap-southeast-2.amazonaws.com/UAT'
const WEBSOCKET_URL = import.meta.env.VITE_WEBSOCKET_URL || 'wss://v4sgq1aoqj.execute-api.ap-southeast-2.amazonaws.com/UAT'

let websocket: WebSocket | null = null

const setStatus = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
  status.value = message
  statusType.value = type
}

const handleFileUpload = async () => {
  const file = fileInput.value?.files?.[0]
  if (!file) {
    setStatus('No file selected', 'error')
    return
  }

  isUploading.value = true
  setStatus('Getting upload URL...', 'info')

  try {
    // Get pre-signed URL
    const response = await fetch(
      `${API_BASE_URL}/upload-url?filename=${encodeURIComponent(file.name)}&contentType=${encodeURIComponent(file.type)}`
    )

    if (!response.ok) {
      throw new Error('Failed to get upload URL')
    }

    const signedUrl = await response.text()

    // Extract jobId from signed URL
    const urlParts = new URL(signedUrl)
    const s3Key = urlParts.pathname.substring(1) // Remove leading slash
    const jobId = s3Key.split('/')[0] // Get directory name as jobId

    setStatus('Uploading to AWS S3...', 'info')

    // Connect to WebSocket before uploading
    await connectWebSocket(jobId)

    // Upload to S3
    const uploadResponse = await fetch(signedUrl, {
      method: 'PUT',
      body: file,
      headers: {
        'Content-Type': file.type,
      },
    })

    if (uploadResponse.ok) {
      setStatus(`Upload successful! Processing started...\nJob ID: ${jobId}`, 'info')
    } else {
      setStatus('Upload failed', 'error')
      websocket?.close()
      isUploading.value = false
    }
  } catch (error) {
    setStatus(`Upload error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error')
    websocket?.close()
    isUploading.value = false
  }
}

const connectWebSocket = (jobId: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    websocket = new WebSocket(WEBSOCKET_URL)

    websocket.onopen = () => {
      console.log('WebSocket connected')
      // Subscribe to job notifications
      websocket?.send(
        JSON.stringify({
          action: 'subscribe',
          jobId: jobId,
        })
      )
      resolve()
    }

    websocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        console.log('WebSocket message:', data)

        if (data.type === 'subscribed') {
          setStatus('🔗 Connected to real-time updates', 'info')
        } else if (data.type === 'processingComplete') {
          const results = data.results
          if (results && results.books && results.books.length > 0) {
            let booksHtml = '<h3>📚 Books Found:</h3><ul>'
            results.books.forEach((book: any) => {
              const title = book.validation?.title || book.title
              const authors = book.validation?.authors?.join(', ') || book.author
              booksHtml += `<li><strong>${title}</strong> by ${authors}`
              if (book.validation?.isbn) {
                booksHtml += ` (ISBN: ${book.validation.isbn})`
              }
              booksHtml += '</li>'
            })
            booksHtml += '</ul>'

            setStatus(
              `🎉 Processing Complete!\nFound ${results.totalCandidates} candidates, validated ${results.validatedBooks} books\n${booksHtml}`,
              'success'
            )
          } else {
            setStatus('Processing complete - no books found in image', 'info')
          }
          websocket?.close()
          isUploading.value = false
        }
      } catch (e) {
        console.error('Error parsing WebSocket message:', e)
      }
    }

    websocket.onerror = (error) => {
      console.error('WebSocket error:', error)
      reject(error)
    }

    websocket.onclose = () => {
      console.log('WebSocket disconnected')
      isUploading.value = false
    }
  })
}

const handleFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement
  if (target.files && target.files[0]) {
    status.value = ''
  }
}

const handleDragOver = (event: DragEvent) => {
  event.preventDefault()
  const uploadArea = event.currentTarget as HTMLElement
  uploadArea.classList.add('dragover')
}

const handleDragLeave = (event: DragEvent) => {
  const uploadArea = event.currentTarget as HTMLElement
  uploadArea.classList.remove('dragover')
}

const handleDrop = (event: DragEvent) => {
  event.preventDefault()
  const uploadArea = event.currentTarget as HTMLElement
  uploadArea.classList.remove('dragover')
  
  const files = event.dataTransfer?.files
  if (files && files.length > 0 && fileInput.value) {
    fileInput.value.files = files
    status.value = ''
  }
}
</script>

<template>
  <div class="app-container">
    <h1>BookImg - AI Book Recognition</h1>
    <p>
      Upload a photo of your bookshelf to extract book titles and authors using AI.
    </p>

    <div 
      class="upload-area"
      :class="{ dragover: false }"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
    >
      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        @change="handleFileSelect"
        :disabled="isUploading"
      />
      <br /><br />
      <button 
        type="button" 
        @click="handleFileUpload"
        :disabled="isUploading"
        class="upload-btn"
      >
        {{ isUploading ? 'Uploading...' : 'Upload Image' }}
      </button>
    </div>

    <div v-if="status" :class="`status ${statusType}`" v-html="status.replace(/\n/g, '<br>')"></div>
  </div>
</template>

<style scoped>
.app-container {
  font-family: Arial, sans-serif;
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
}

.upload-area {
  border: 2px dashed #ccc;
  padding: 40px;
  text-align: center;
  margin: 20px 0;
  transition: all 0.3s ease;
}

.upload-area.dragover {
  border-color: #007bff;
  background-color: #f8f9fa;
}

.upload-btn {
  background: #007bff;
  color: white;
  border: none;
  padding: 10px 20px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 16px;
}

.upload-btn:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.upload-btn:hover:not(:disabled) {
  background: #0056b3;
}

.status {
  margin: 20px 0;
  padding: 10px;
  border-radius: 4px;
  white-space: pre-line;
}

.status.success {
  background: #d4edda;
  border: 1px solid #c3e6cb;
  color: #155724;
}

.status.error {
  background: #f8d7da;
  border: 1px solid #f5c6cb;
  color: #721c24;
}

.status.info {
  background: #cce7ff;
  border: 1px solid #99d6ff;
  color: #004085;
}

h1 {
  color: #333;
  text-align: center;
}

p {
  text-align: center;
  color: #666;
  font-size: 16px;
}
</style>
