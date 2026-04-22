# API Documentation

OpenPlaud API reference for all endpoints.

## Base URL

```
http://localhost:3000/api
```

## Authentication

All authenticated endpoints require a valid session cookie set by Better Auth.

## Endpoints

### Health

#### GET `/health`

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-01-22T12:00:00.000Z"
}
```

---

### Authentication

#### POST `/auth/sign-up`

Create a new user account.

**Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword",
  "name": "John Doe"
}
```

#### POST `/auth/sign-in`

Sign in to existing account.

**Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword"
}
```

#### POST `/auth/sign-out`

Sign out current user.

---

### Plaud Integration

#### POST `/plaud/auth/send-code`

Send a one-time verification code to the user's Plaud email. Handles regional redirects automatically — if the account lives on a different regional server, the correct `apiBase` is returned.

**Body:**
```json
{
  "email": "user@example.com"
}
```

**Response:**
```json
{
  "success": true,
  "otpToken": "eyJhbGc...",
  "apiBase": "https://api-euc1.plaud.ai"
}
```

#### POST `/plaud/auth/verify`

Verify the OTP code, obtain a long-lived access token from Plaud, and store the encrypted connection.

**Body:**
```json
{
  "code": "123456",
  "otpToken": "eyJhbGc...",
  "apiBase": "https://api-euc1.plaud.ai",
  "email": "user@example.com"
}
```

**Response:**
```json
{
  "success": true,
  "devices": [...]
}
```

#### GET `/plaud/connection`

Get current Plaud connection status.

**Response:**
```json
{
  "connected": true,
  "server": "eu",
  "plaudEmail": "user@example.com",
  "createdAt": "2025-01-22T12:00:00.000Z",
  "updatedAt": "2025-01-22T12:00:00.000Z"
}
```

#### DELETE `/plaud/connection`

Disconnect the current Plaud account. Deletes the stored connection and device records; synced recordings are preserved in OpenPlaud storage.

**Response:**
```json
{
  "success": true
}
```

#### POST `/plaud/sync`

Manually trigger sync of recordings from Plaud device.

**Response:**
```json
{
  "success": true,
  "newRecordings": 5,
  "updatedRecordings": 2,
  "errors": []
}
```

---

### Recordings

#### GET `/recordings`

List all recordings for current user.

**Query Parameters:**
- `limit` (optional): Number of results (default: 50)
- `offset` (optional): Pagination offset (default: 0)

**Response:**
```json
{
  "recordings": [
    {
      "id": "abc123",
      "filename": "Meeting Notes",
      "duration": 3600000,
      "startTime": "2025-01-22T10:00:00.000Z",
      "filesize": 15728640,
      "deviceSn": "888317426694681884"
    }
  ],
  "total": 100
}
```

#### GET `/recordings/[id]`

Get single recording by ID.

**Response:**
```json
{
  "id": "abc123",
  "filename": "Meeting Notes",
  "duration": 3600000,
  "startTime": "2025-01-22T10:00:00.000Z",
  "transcription": {...},
  "aiEnhancements": {...}
}
```

#### GET `/recordings/[id]/audio`

Stream audio file.

**Headers:**
- `Range`: Optional byte range (e.g., `bytes=0-1023`)

**Response:**
- Content-Type: audio/mpeg, audio/opus, etc.
- Supports HTTP range requests (206 Partial Content)

#### POST `/recordings/[id]/transcribe`

Transcribe a recording.

**Body:**
```json
{
  "provider": "openai",
  "model": "whisper-1"
}
```

**Response:**
```json
{
  "success": true,
  "transcriptionId": "xyz789",
  "text": "Transcribed text...",
  "detectedLanguage": "en"
}
```

---

### Settings

#### GET `/settings/user`

Get user settings.

**Response:**
```json
{
  "autoTranscribe": false,
  "emailNotifications": true,
  "notificationEmail": "user@example.com",
  "syncInterval": 300000,
  "defaultPlaybackSpeed": 1.0
}
```

#### PUT `/settings/user`

Update user settings.

**Body:**
```json
{
  "autoTranscribe": true,
  "emailNotifications": true
}
```

#### PUT `/settings/storage`

Configure storage provider.

**Body:**
```json
{
  "storageType": "s3",
  "s3Config": {
    "endpoint": "https://...",
    "bucket": "openplaud",
    "region": "us-east-1",
    "accessKeyId": "...",
    "secretAccessKey": "..."
  }
}
```

#### GET `/settings/ai/providers`

List AI providers.

**Response:**
```json
{
  "providers": [
    {
      "id": "xyz",
      "provider": "openai",
      "baseUrl": null,
      "defaultModel": "whisper-1",
      "isDefaultTranscription": true
    }
  ]
}
```

#### POST `/settings/ai/providers`

Add new AI provider.

**Body:**
```json
{
  "provider": "groq",
  "apiKey": "gsk_...",
  "baseUrl": "https://api.groq.com/openai/v1",
  "defaultModel": "whisper-large-v3",
  "isDefaultTranscription": true
}
```

#### PUT `/settings/ai/providers/[id]`

Update AI provider.

#### DELETE `/settings/ai/providers/[id]`

Delete AI provider.

#### POST `/settings/test-email`

Send test email to verify SMTP configuration.

**Body:**
```json
{
  "email": "user@example.com"
}
```

---

### Export & Backup

#### GET `/export`

Export recordings in various formats.

**Query Parameters:**
- `format`: json | txt | srt | vtt

**Response:**
- File download

#### POST `/backup`

Create backup of all user data.

**Response:**
```json
{
  "success": true,
  "backupUrl": "/backups/user_20250122_120000.zip"
}
```

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

### Error Codes

- `UNAUTHORIZED`: Not authenticated
- `FORBIDDEN`: Insufficient permissions
- `NOT_FOUND`: Resource not found
- `INVALID_INPUT`: Validation failed
- `PLAUD_API_ERROR`: Plaud API failure
- `TRANSCRIPTION_FAILED`: Transcription error
- `STORAGE_ERROR`: Storage operation failed
- `EMAIL_SEND_FAILED`: Email notification failed
- `INTERNAL_ERROR`: Server error

---

## Rate Limiting

Rate limiting is not currently enforced but may be added in future versions.

## Webhooks

Webhooks are not currently supported but are planned for a future release.

## SDK / Client Libraries

Currently, no official SDK is available. The API is RESTful and can be consumed by any HTTP client.

Example with JavaScript:

```javascript
// Fetch recordings
const response = await fetch('/api/recordings', {
  credentials: 'include'  // Include session cookie
});
const data = await response.json();
```

---

For more details, see the source code in `src/app/api/`.
