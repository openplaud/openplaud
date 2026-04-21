<div align="center">

# 🎙️ OpenPlaud

**Self-hosted AI transcription interface for Plaud Note devices**

*Replace Plaud's $20/month AI subscription with your own OpenAI-compatible API keys*

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white)](https://hub.docker.com/r/openplaud/openplaud)
[![TypeScript](https://img.shields.io/badge/typescript-5.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/next.js-16-000000?logo=next.js&logoColor=white)](https://nextjs.org/)

[Quick Start](#-quick-start) • [Features](#-features) • [Configuration](#-configuration-guide) • [Contributing](#-contributing) • [License](#-license)

</div>

---

## ✨ Features

### 🔐 Privacy & Control
- **Self-Hosted** - Complete control over your data and API keys
- **Encrypted Credentials** - AES-256-GCM encryption for all sensitive data
- **No Vendor Lock-in** - Your recordings, your infrastructure

### 🤖 AI & Transcription
- **Universal AI Support** - Works with ANY OpenAI-compatible API:
  - OpenAI, Groq, Together AI, OpenRouter
  - Local models: LM Studio, Ollama
  - And any other OpenAI-compatible endpoint
- **Browser Transcription** - Client-side transcription using Transformers.js (zero API costs!)
- **AI Title Generation** - Automatically generate descriptive titles from transcriptions
- **Multiple AI Providers** - Configure and switch between different providers

### 💾 Storage & Sync
- **Flexible Storage** - Local filesystem OR S3-compatible storage:
  - AWS S3, Cloudflare R2, MinIO
  - DigitalOcean Spaces, Wasabi, Backblaze B2
- **Auto-Sync** - Automatically download recordings from Plaud devices
- **Configurable Intervals** - Set your own sync schedule

### 📤 Export & Notifications
- **Multiple Export Formats** - JSON, TXT, SRT, VTT subtitle formats
- **Full Backups** - Export all your data with one click
- **Browser Notifications** - Real-time alerts for new recordings
- **Email Notifications** - SMTP support for email alerts

### 🚀 Deployment & UX
- **Zero-Config Deployment** - Up and running with one Docker Compose command
- **Guided Onboarding** - Interactive setup wizard for new users
- **Modern UI** - Clean, hardware-inspired design with dark theme support
- **Comprehensive Error Handling** - Graceful failures with helpful error messages

## 🚀 Quick Start

### Prerequisites

- 🐳 Docker & Docker Compose
- 🎙️ Plaud Note device with account at [plaud.ai](https://plaud.ai)
- 🤖 OpenAI API key (or any OpenAI-compatible provider)

### Installation

**1. Clone the repository**

```bash
git clone https://github.com/openplaud/openplaud.git
cd openplaud
```

**2. Generate encryption keys**

```bash
# Generate BETTER_AUTH_SECRET
openssl rand -hex 32

# Generate ENCRYPTION_KEY
openssl rand -hex 32
```

**3. Create and configure .env.local file**

```bash
cp .env.example .env.local
```

Edit `.env.local` with your generated keys:

```env
# Required
BETTER_AUTH_SECRET=<your-generated-secret>
ENCRYPTION_KEY=<your-generated-key>
APP_URL=http://localhost:3000
DATABASE_URL=postgresql://postgres:postgres@db:5432/openplaud

# Optional - Email notifications (SMTP)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@example.com
SMTP_PASSWORD=your-password
SMTP_FROM=noreply@example.com

# Optional - Storage defaults
DEFAULT_STORAGE_TYPE=local
LOCAL_STORAGE_PATH=./storage
```

**4. Start the application**

```bash
docker compose up -d
```

**5. Access OpenPlaud**

Open **http://localhost:3000** and create your account!

The onboarding wizard will guide you through:
- Connecting your Plaud device
- Configuring AI providers
- Setting up storage
- Customizing sync preferences

## 📖 Configuration Guide

### 🔑 Connecting Your Plaud Account

OpenPlaud signs into Plaud directly using your email — the same way the official Plaud app does:

1. Enter the email address you use on [plaud.ai](https://plaud.ai)
2. Plaud sends you a verification code
3. Enter the code in OpenPlaud — that's it

Your email and code are forwarded directly to Plaud's servers and **never stored** by OpenPlaud. After login, the access token is encrypted (AES-256-GCM) and stored only on your self-hosted instance. Your account region (Global, EU, Asia Pacific) is detected automatically.

> 🔓 **Open Source**: Every line that handles your credentials is available for inspection — [send-code route](src/app/api/plaud/auth/send-code/route.ts) · [verify route](src/app/api/plaud/auth/verify/route.ts) · [encryption](src/lib/encryption.ts)

### 💾 Storage Options

#### 📁 Local Filesystem (Default)

Recordings are stored in Docker volume `/app/audio`. No additional configuration needed.

**Pros**: Zero setup, works out of the box  
**Cons**: Limited to host machine storage

#### ☁️ S3-Compatible Storage

OpenPlaud supports ANY S3-compatible service. Configure through the settings UI or via environment variables.

<details>
<summary><b>🗄️ AWS S3</b></summary>

```
Endpoint: (leave blank)
Bucket: your-bucket-name
Region: us-east-1
Access Key ID: YOUR_KEY
Secret Access Key: YOUR_SECRET
```

</details>

<details>
<summary><b>🌐 Cloudflare R2</b></summary>

```
Endpoint: https://<account-id>.r2.cloudflarestorage.com
Bucket: openplaud
Region: auto
Access Key ID: YOUR_KEY
Secret Access Key: YOUR_SECRET
```

**Note**: R2 offers 10GB free storage with no egress fees!

</details>

<details>
<summary><b>🐳 MinIO (Self-hosted)</b></summary>

```
Endpoint: http://minio:9000
Bucket: openplaud
Region: us-east-1
Access Key ID: minioadmin
Secret Access Key: minioadmin
```

Perfect for self-hosted deployments!

</details>

<details>
<summary><b>🌊 DigitalOcean Spaces</b></summary>

```
Endpoint: https://<region>.digitaloceanspaces.com
Bucket: your-space-name
Region: <region>
Access Key ID: YOUR_KEY
Secret Access Key: YOUR_SECRET
```

</details>

<details>
<summary><b>💧 Backblaze B2</b></summary>

```
Endpoint: https://s3.<region>.backblazeb2.com
Bucket: your-bucket-name
Region: <region>
Access Key ID: YOUR_KEY
Secret Access Key: YOUR_SECRET
```

Excellent pricing for long-term storage!

</details>

### 🤖 AI Provider Setup

OpenPlaud uses the OpenAI SDK with custom `baseURL` support, making it compatible with **any** OpenAI-compatible API.

> 💡 **Configure multiple providers** and switch between them based on your needs!

<details>
<summary><b>OpenAI (Official)</b></summary>

- **Base URL**: (leave blank)
- **API Key**: Your OpenAI key
- **Models**: `whisper-1`, `gpt-4o`, `gpt-4-turbo`, `gpt-3.5-turbo`

Best for: Production quality, latest models

</details>

<details>
<summary><b>🚀 Groq (Free Whisper API!)</b></summary>

- **Base URL**: `https://api.groq.com/openai/v1`
- **API Key**: Your Groq key
- **Models**: `whisper-large-v3`, `llama-3.1-70b-versatile`

Best for: **Free transcription**, ultra-fast inference

</details>

<details>
<summary><b>Together AI</b></summary>

- **Base URL**: `https://api.together.xyz/v1`
- **API Key**: Your Together AI key
- **Models**: `whisper-large-v3`, `meta-llama/Llama-3-70b-chat-hf`

Best for: Cost-effective, diverse model selection

</details>

<details>
<summary><b>OpenRouter (Access to Claude, GPT-4, Llama)</b></summary>

- **Base URL**: `https://openrouter.ai/api/v1`
- **API Key**: Your OpenRouter key
- **Models**: `anthropic/claude-3.5-sonnet`, `openai/gpt-4-turbo`, `meta-llama/llama-3-70b-instruct`

Best for: Access to multiple providers through one API

</details>

<details>
<summary><b>🏠 LM Studio (Local Models)</b></summary>

- **Base URL**: `http://localhost:1234/v1`
- **API Key**: `lm-studio` (or any string)
- **Models**: Name of your loaded model

Best for: 100% private, offline transcription

</details>

<details>
<summary><b>🦙 Ollama (Local Models)</b></summary>

- **Base URL**: `http://localhost:11434/v1`
- **API Key**: `ollama` (or any string)
- **Models**: `whisper`, `llama3`, `mistral`, etc.

Best for: Easy local model management

</details>

<details>
<summary><b>📚 Azure OpenAI</b></summary>

- **Base URL**: `https://<resource>.openai.azure.com/openai/deployments/<deployment>`
- **API Key**: Your Azure OpenAI key
- **Models**: Your deployment name

Best for: Enterprise compliance, Azure integration

</details>

### 🌐 Browser-Based Transcription (Free!)

OpenPlaud supports **client-side transcription** using Transformers.js, running Whisper models directly in your browser:

| Feature | Description |
|---------|-------------|
| 💰 **Zero API Costs** | Runs entirely in the browser |
| 🔒 **Privacy-First** | Audio never leaves your device |
| 🤖 **Models Available** | `whisper-tiny`, `whisper-base`, `whisper-small` |
| 🎯 **Auto-Detected** | Automatically available in transcription UI |

> ⚠️ **Note**: Browser transcription is slower than server-side but completely free and private. Perfect for sensitive recordings!

## 🏗️ Architecture

### Tech Stack

<table>
<tr>
<td width="50%" valign="top">

**Frontend**
- Next.js 16 (App Router)
- TypeScript
- Tailwind CSS
- Framer Motion
- Wavesurfer.js (audio visualization)

**Backend**
- PostgreSQL
- Drizzle ORM
- Better Auth

</td>
<td width="50%" valign="top">

**AI & Transcription**
- OpenAI SDK (universal compatibility)
- Transformers.js (browser transcription)

**Storage**
- Local filesystem
- S3-compatible (AWS, R2, MinIO, etc.)

**Deployment**
- Docker & Docker Compose
- Single-container architecture

</td>
</tr>
</table>

### Database Schema

| Table | Purpose |
|-------|---------|
| `users` & `sessions` | Authentication (Better Auth) |
| `plaud_connections` | Encrypted Plaud bearer tokens |
| `plaud_devices` | Connected Plaud devices |
| `recordings` | Recording metadata + storage paths |
| `transcriptions` | AI-generated transcriptions |
| `ai_enhancements` | Summaries, action items, key points |
| `api_credentials` | Encrypted AI API keys (multiple providers) |
| `storage_config` | User storage preferences (local/S3) |
| `user_settings` | Sync, notifications, playback, export preferences |

### 🔒 Security

- 🔐 **AES-256-GCM encryption** for all sensitive data (API keys, tokens)
- 🛡️ **Better Auth** for secure session management
- 🗄️ **PostgreSQL** for reliable data persistence
- 🐳 **Docker isolation** for secure deployment
- 🚫 **No telemetry** - Your data stays yours

## 🎨 Design Philosophy

OpenPlaud features a **hardware-inspired design** that brings the tactile feel of audio equipment to the web:

| Component | Description |
|-----------|-------------|
| 🎛️ **Rotary Knobs** | Draggable 360° rotation with LED ring indicators |
| 💡 **LED Indicators** | Animated glow effects for status feedback |
| 🎚️ **Hardware Rack Modules** | Authentic audio equipment aesthetic with mounting holes |
| 📊 **Waveform Display** | Real-time audio visualization (Wavesurfer.js) |
| 🌙 **Dark Theme** | Easy on the eyes for long listening sessions |
| 🧭 **Guided Onboarding** | Interactive setup wizard for new users |

> 💡 The UI is inspired by professional audio workstations, combining functionality with aesthetics.

## 🔧 Development

### Local Setup

```bash
# Install dependencies
pnpm install

# Setup database
createdb openplaud
pnpm db:migrate

# Start dev server
bun dev
```

The dev server will start at **http://localhost:3000**

### Database Management

| Command | Description |
|---------|-------------|
| `pnpm db:generate` | Generate new migration from schema changes |
| `bun db:migrate` | Apply migrations to database |
| `pnpm db:studio` | Open Drizzle Studio (visual database browser) |

### Testing

#### Unit Tests

```bash
# Run all tests
bun test

# Run specific test file
bun test src/tests/plaud.test.ts
```

#### Integration Tests

Live Plaud API tests are **opt-in** to avoid credential leaks and rate limits:

```bash
export PLAUD_BEARER_TOKEN="Bearer eyJhbGciOi..."
bun test src/tests/plaud.integration.test.ts
```

> 💡 Integration tests run against the real Plaud API. Leave `PLAUD_BEARER_TOKEN` unset in CI to skip them.

### Project Structure

```
src/
├── app/              # Next.js App Router pages
│   ├── (app)/       # Authenticated routes
│   ├── (auth)/      # Authentication pages
│   └── api/         # API routes
├── components/       # React components
│   ├── ui/          # shadcn/ui components
│   └── dashboard/   # Feature components
├── lib/             # Core business logic
│   ├── ai/          # AI integration
│   ├── plaud/       # Plaud API client
│   ├── storage/     # Storage abstraction
│   └── transcription/ # Transcription logic
├── db/              # Database schema & migrations
└── types/           # TypeScript type definitions
```

## 📊 API Reference

<details>
<summary><b>🔐 Authentication</b></summary>

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/sign-up` | Create account |
| `POST` | `/api/auth/sign-in` | Login |
| `POST` | `/api/auth/sign-out` | Logout |

</details>

<details>
<summary><b>🎙️ Plaud Integration</b></summary>

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/plaud/connect` | Connect Plaud device |
| `GET` | `/api/plaud/connection` | Check connection status |
| `POST` | `/api/plaud/sync` | Manual sync recordings |

</details>

<details>
<summary><b>🎵 Recordings</b></summary>

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/recordings` | List all recordings |
| `GET` | `/api/recordings/[id]` | Get recording details |
| `GET` | `/api/recordings/[id]/audio` | Stream audio file |
| `POST` | `/api/recordings/[id]/transcribe` | Transcribe recording |

</details>

<details>
<summary><b>⚙️ Settings</b></summary>

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/settings/user` | Get user settings |
| `PUT` | `/api/settings/user` | Update user settings |
| `PUT` | `/api/settings/storage` | Configure storage |
| `GET` | `/api/settings/ai/providers` | List AI providers |
| `POST` | `/api/settings/ai/providers` | Add AI provider |
| `PUT` | `/api/settings/ai/providers/[id]` | Update AI provider |
| `DELETE` | `/api/settings/ai/providers/[id]` | Delete AI provider |

</details>

<details>
<summary><b>📤 Export & Backup</b></summary>

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/export?format=json\|txt\|srt\|vtt` | Export recordings |
| `POST` | `/api/backup` | Create backup of all user data |

</details>

<details>
<summary><b>🏥 Health</b></summary>

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check endpoint |

</details>

## 🤝 Contributing

We welcome contributions from the community! Here's how you can help:

### Ways to Contribute

- 🐛 **Report bugs** - Found an issue? [Open a bug report](https://github.com/openplaud/openplaud/issues/new)
- 💡 **Request features** - Have an idea? [Create a feature request](https://github.com/openplaud/openplaud/issues/new)
- 📝 **Improve docs** - Documentation PRs are always welcome
- 🔧 **Submit PRs** - See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines
- ⭐ **Star the repo** - Show your support!

### Development Workflow

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes following our code standards
4. Test your changes (`bun test`)
5. Commit with Gitflow conventions (`git commit -m 'feat: add amazing feature'`)
6. Push to your fork (`git push origin feature/amazing-feature`)
7. Open a Pull Request

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

## 📝 License

**AGPL-3.0 License** – see [LICENSE](LICENSE) file for details

This means:
- ✅ Free to use, modify, and distribute
- ✅ Can use for commercial purposes
- ⚠️ Must open-source any modifications if you run it as a service
- ⚠️ Must include original license and copyright

## 🙏 Acknowledgments

Originally created by **Perier**. Now developed and maintained by the OpenPlaud community.

Made with ❤️ for Plaud Note users who want full control over their transcriptions.

## 📚 Resources

- 📖 [Documentation](docs/) - Detailed guides and API references
- 🐛 [Issues](https://github.com/openplaud/openplaud/issues) - Bug reports and feature requests
- 💬 [Discussions](https://github.com/openplaud/openplaud/discussions) - Community discussions
- 📝 [Changelog](CHANGELOG.md) - Version history and release notes

## ⭐ Support the Project

If OpenPlaud is useful to you, consider:
- ⭐ Starring the repository
- 🐛 Reporting bugs and suggesting features
- 📝 Contributing code or documentation
- 💬 Helping others in discussions

---

<div align="center">

**[⬆ Back to Top](#-openplaud)**

</div>
