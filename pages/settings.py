import streamlit as st
import requests
from api.config import settings

API_BASE_URL = f"http://{settings.api_host}:{settings.api_port}"


def show():
    st.title("⚙️ Settings")
    st.markdown("Configure OpenPlaud")

    tab1, tab2, tab3, tab4 = st.tabs([
        "General",
        "AI Providers",
        "Storage",
        "Notifications",
    ])

    with tab1:
        st.subheader("General Settings")

        # Fetch current settings
        try:
            response = requests.get(f"{API_BASE_URL}/api/settings/")
            response.raise_for_status()
            current_settings = response.json()
        except:
            current_settings = {}

        col1, col2 = st.columns(2)

        with col1:
            sync_interval = st.slider(
                "Sync interval (seconds)",
                min_value=60,
                max_value=3600,
                value=current_settings.get("sync_interval", 300) // 1000,
                step=60,
            )

            auto_sync = st.checkbox(
                "Auto-sync enabled",
                value=current_settings.get("auto_sync_enabled", True),
            )

        with col2:
            auto_transcribe = st.checkbox(
                "Auto-transcribe new recordings",
                value=current_settings.get("auto_transcribe", False),
            )

            transcription_quality = st.selectbox(
                "Transcription quality",
                ["fast", "balanced", "accurate"],
                index=["fast", "balanced", "accurate"].index(
                    current_settings.get("transcription_quality", "balanced")
                ),
            )

        theme = st.selectbox(
            "Theme",
            ["light", "dark", "system"],
            index=["light", "dark", "system"].index(
                current_settings.get("theme", "system")
            ),
        )

        if st.button("💾 Save General Settings"):
            try:
                update_data = {
                    "sync_interval": sync_interval * 1000,
                    "auto_sync_enabled": auto_sync,
                    "auto_transcribe": auto_transcribe,
                    "transcription_quality": transcription_quality,
                    "theme": theme,
                }
                response = requests.patch(
                    f"{API_BASE_URL}/api/settings/",
                    json=update_data,
                )
                response.raise_for_status()
                st.success("Settings saved!")
            except Exception as e:
                st.error(f"Failed to save settings: {e}")

    with tab2:
        st.subheader("AI Providers")
        st.write("Configure API keys for transcription and enhancement")

        col1, col2 = st.columns(2)

        with col1:
            provider = st.selectbox(
                "Provider",
                ["openai", "groq", "anthropic", "together-ai"],
            )

        with col2:
            api_key = st.text_input("API Key", type="password")

        base_url = st.text_input("Base URL (optional)", placeholder="https://api.groq.com/openai/v1")
        default_model = st.text_input("Default Model (optional)", placeholder="whisper-1")

        col1, col2 = st.columns(2)
        with col1:
            is_default_transcription = st.checkbox("Use for transcription")
        with col2:
            is_default_enhancement = st.checkbox("Use for enhancement")

        if st.button("➕ Add Provider"):
            try:
                data = {
                    "provider": provider,
                    "api_key": api_key,
                    "base_url": base_url or None,
                    "default_model": default_model or None,
                }
                response = requests.post(
                    f"{API_BASE_URL}/api/settings/providers",
                    params=data,
                )
                response.raise_for_status()
                st.success(f"Provider {provider} added!")
                st.rerun()
            except Exception as e:
                st.error(f"Failed to add provider: {e}")

        st.markdown("---")
        st.subheader("Configured Providers")

        try:
            response = requests.get(f"{API_BASE_URL}/api/settings/providers")
            response.raise_for_status()
            providers = response.json()

            for provider in providers:
                col1, col2, col3 = st.columns([3, 1, 1])
                with col1:
                    st.write(f"**{provider['provider']}**")
                    if provider.get("is_default_transcription"):
                        st.caption("🎤 Default transcription")
                    if provider.get("is_default_enhancement"):
                        st.caption("✨ Default enhancement")

                with col2:
                    st.caption(provider["id"][:8] + "...")

                with col3:
                    if st.button("🗑️", key=f"delete_provider_{provider['id']}"):
                        requests.delete(f"{API_BASE_URL}/api/settings/providers/{provider['id']}")
                        st.rerun()

                st.divider()

        except Exception as e:
            st.warning(f"Failed to fetch providers: {e}")

    with tab3:
        st.subheader("Storage Configuration")

        # Fetch current storage config
        try:
            response = requests.get(f"{API_BASE_URL}/api/settings/storage")
            response.raise_for_status()
            current_storage = response.json()
        except:
            current_storage = {"storage_type": "local"}

        storage_type = st.radio(
            "Storage Type",
            ["local", "s3"],
            index=0 if current_storage.get("storage_type") == "local" else 1,
        )

        if storage_type == "local":
            st.info("Recordings are stored locally on your system.")
            st.text_input(
                "Storage Path",
                value="/data/recordings",
                disabled=True,
            )

        else:  # s3
            s3_endpoint = st.text_input("S3 Endpoint", placeholder="https://s3.amazonaws.com")
            s3_bucket = st.text_input("Bucket Name")
            s3_region = st.text_input("Region", placeholder="us-east-1")
            s3_access_key = st.text_input("Access Key", type="password")
            s3_secret_key = st.text_input("Secret Key", type="password")

            if st.button("🔒 Save S3 Configuration"):
                try:
                    s3_config = {
                        "endpoint": s3_endpoint,
                        "bucket": s3_bucket,
                        "region": s3_region,
                        "access_key": s3_access_key,
                        "secret_key": s3_secret_key,
                    }
                    response = requests.patch(
                        f"{API_BASE_URL}/api/settings/storage",
                        params={
                            "storage_type": "s3",
                            "s3_config": s3_config,
                        },
                    )
                    response.raise_for_status()
                    st.success("S3 configuration saved!")
                except Exception as e:
                    st.error(f"Failed to save S3 configuration: {e}")

    with tab4:
        st.subheader("Notification Settings")

        col1, col2 = st.columns(2)

        with col1:
            browser_notifications = st.checkbox("Browser notifications", value=True)
            notification_sound = st.checkbox("Notification sound", value=True)

        with col2:
            email_notifications = st.checkbox("Email notifications", value=False)
            if email_notifications:
                notification_email = st.text_input("Email address")

        if st.button("💾 Save Notification Settings"):
            try:
                update_data = {
                    "browser_notifications": browser_notifications,
                    "notification_sound": notification_sound,
                    "email_notifications": email_notifications,
                    "notification_email": notification_email if email_notifications else None,
                }
                response = requests.patch(
                    f"{API_BASE_URL}/api/settings/",
                    json=update_data,
                )
                response.raise_for_status()
                st.success("Settings saved!")
            except Exception as e:
                st.error(f"Failed to save settings: {e}")
