# OpenPlaud Python

A pure-Python conversion of OpenPlaud - self-hosted AI transcription for Plaud devices.

**Tech Stack:**
- **Frontend:** Streamlit (Python-native UI)
- **Backend:** FastAPI (async REST API)
- **Database:** PostgreSQL with SQLAlchemy ORM
- **Transcription:** OpenAI-compatible APIs + local Whisper models
- **Storage:** Local filesystem or S3-compatible services

## Features

- 🎙️ **Transcription:** Convert audio to text using OpenAI API or local models
- 🔗 **Plaud Integration:** Sync recordings from Plaud devices
- ⚙️ **Settings:** Configure AI providers, storage, notifications
- 📤 **Export:** Download transcriptions in JSON, TXT, SRT, VTT formats
- 🔒 **Security:** AES-256 encryption for sensitive data
- 🚀 **Deployment:** Docker containerization for easy deployment

## Quick Start

### Prerequisites
- Python 3.11+
- PostgreSQL 16
- Docker & Docker Compose (optional)

### Development Setup

1. **Clone the repository**
   ```bash
   cd openplaud-python
   ```

2. **Create and activate virtual environment**
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Set up environment**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

5. **Set up database**
   ```bash
   # Create PostgreSQL database first
   createdb openplaud_db
   
   # Run migrations
   alembic upgrade head
   ```

6. **Run the application**

   **Terminal 1 - API Server:**
   ```bash
   uvicorn api.main:app --reload
   ```

   **Terminal 2 - Streamlit Frontend:**
   ```bash
   streamlit run streamlit_app.py
   ```

   Access:
   - API: http://localhost:8000
   - API Docs: http://localhost:8000/docs
   - Frontend: http://localhost:8501

### Docker Deployment

```bash
docker-compose up -d
```

Access:
- API: http://localhost:8000
- Frontend: http://localhost:8501

## Project Structure

```
openplaud-python/
├── api/                      # FastAPI backend
│   ├── main.py              # FastAPI app entry point
│   ├── config.py            # Settings management (Pydantic)
│   ├── models/              # SQLAlchemy ORM models
│   ├── routes/              # API endpoints
│   │   ├── recordings.py    # Recording CRUD
│   │   ├── transcriptions.py # Transcription endpoints
│   │   ├── settings.py      # Settings management
│   │   └── plaud.py         # Plaud device integration
│   ├── schemas/             # Pydantic request/response models
│   ├── dependencies/        # Dependency injection
│   └── utils/               # Utility modules
│       ├── encryption.py    # AES-256 encryption
│       ├── storage.py       # File storage abstraction
│       ├── transcription.py # Transcription service
│       └── plaud_client.py  # Plaud API client
├── db/                      # Database
│   ├── base.py             # SQLAlchemy Base
│   ├── engine.py           # DB connection & sessions
│   └── migrations/         # Alembic migrations
├── pages/                  # Streamlit pages
│   ├── dashboard.py        # Recording list & management
│   ├── transcribe.py       # Upload & transcribe
│   ├── settings.py         # Configuration UI
│   ├── export.py           # Data export
│   └── plaud_connect.py    # Plaud device connection
├── streamlit_app.py        # Streamlit entry point
├── requirements.txt        # Python dependencies
├── alembic.ini            # Alembic configuration
├── Dockerfile             # Container image
├── docker-compose.yml     # Docker services
└── README.md              # This file
```

## Configuration

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost/openplaud_db

# API
API_HOST=localhost
API_PORT=8000

# Streamlit
STREAMLIT_HOST=localhost
STREAMLIT_PORT=8501

# Security
SECRET_KEY=<min 32 chars>

# Storage
STORAGE_TYPE=local|s3
STORAGE_LOCAL_PATH=/data/recordings

# AI Providers
OPENAI_API_KEY=<your-api-key>
```

## API Endpoints

### Recordings
- `GET /api/recordings/` - List recordings
- `POST /api/recordings/` - Create recording
- `GET /api/recordings/{id}` - Get recording
- `PATCH /api/recordings/{id}` - Update recording
- `DELETE /api/recordings/{id}` - Delete recording

### Transcriptions
- `GET /api/transcriptions/` - List transcriptions
- `POST /api/transcriptions/` - Create transcription
- `GET /api/transcriptions/{recording_id}` - Get transcription

### Settings
- `GET /api/settings/` - Get settings
- `PATCH /api/settings/` - Update settings
- `GET /api/settings/providers` - List API providers
- `POST /api/settings/providers` - Add provider

### Plaud
- `POST /api/plaud/connect` - Connect Plaud account
- `GET /api/plaud/connection` - Get connection status
- `POST /api/plaud/sync` - Sync recordings
- `GET /api/plaud/devices` - List devices

## Database Schema

Key tables:
- **recordings** - Recording metadata and storage info
- **transcriptions** - AI-generated transcriptions
- **ai_enhancements** - Summaries, key points, action items
- **api_credentials** - Encrypted API keys for AI providers
- **storage_config** - Storage backend configuration
- **app_settings** - Application-wide settings
- **plaud_connections** - Encrypted Plaud bearer tokens
- **plaud_devices** - Connected Plaud devices

## Storage Backends

### Local Filesystem
```bash
STORAGE_TYPE=local
STORAGE_LOCAL_PATH=/data/recordings
```

### S3-Compatible (AWS, MinIO, DigitalOcean, Cloudflare R2)
```bash
STORAGE_TYPE=s3
S3_ENDPOINT=https://s3.amazonaws.com
S3_BUCKET=my-bucket
S3_REGION=us-east-1
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
```

## Development

### Create Database Migration

```bash
# Make changes to models in api/models/
# Then generate migration:
alembic revision --autogenerate -m "Add new column"
alembic upgrade head
```

### Run Tests

```bash
pytest
```

### Format & Lint

```bash
black api db
flake8 api db
```

## Security Notes

- API keys and Plaud tokens are encrypted with AES-256-GCM
- CORS is open by default - restrict in production
- Use HTTPS in production deployments
- PostgreSQL password should be strong
- Rotate SECRET_KEY before production deployment

## Troubleshooting

### Database Connection Error
```bash
# Check PostgreSQL is running
psql -U openplaud -d openplaud_db

# Check DATABASE_URL in .env
echo $DATABASE_URL
```

### Migration Failures
```bash
# Reset migrations (careful!)
alembic downgrade base
alembic upgrade head
```

### Streamlit Not Loading
```bash
# Check API is running
curl http://localhost:8000/health

# Check Streamlit logs
streamlit run streamlit_app.py --logger.level=debug
```

## Contributing

1. Create a feature branch
2. Make changes
3. Test thoroughly
4. Submit PR

## License

AGPL-3.0 (same as original OpenPlaud)

## Support

For issues and questions:
- GitHub Issues: [openplaud/openplaud](https://github.com/openplaud/openplaud)
- Documentation: See original project for detailed guides
