import streamlit as st
import requests
import json
from datetime import datetime
from api.config import settings

API_BASE_URL = f"http://{settings.api_host}:{settings.api_port}"


def show():
    st.title("📤 Export")
    st.markdown("Export your recordings and transcriptions")

    tab1, tab2 = st.tabs(["Export Records", "Backup"])

    with tab1:
        st.subheader("Export Recordings")

        col1, col2 = st.columns(2)

        with col1:
            format_type = st.selectbox(
                "Export format",
                ["json", "txt", "srt", "vtt"],
            )

        with col2:
            include_audio = st.checkbox("Include audio files", value=False)

        if st.button("📥 Generate Export"):
            progress_bar = st.progress(0)
            status_text = st.empty()

            try:
                status_text.text("Fetching recordings...")
                response = requests.get(f"{API_BASE_URL}/api/recordings/")
                response.raise_for_status()
                recordings = response.json()

                progress_bar.progress(30)
                status_text.text(f"Fetching transcriptions...")

                response = requests.get(f"{API_BASE_URL}/api/transcriptions/")
                response.raise_for_status()
                transcriptions = response.json()

                progress_bar.progress(60)
                status_text.text("Generating export...")

                # Create export data
                export_data = {
                    "export_date": datetime.now().isoformat(),
                    "format": format_type,
                    "recordings": recordings,
                    "transcriptions": transcriptions,
                }

                progress_bar.progress(90)

                if format_type == "json":
                    export_content = json.dumps(export_data, indent=2)
                    filename = f"openplaud_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
                elif format_type == "txt":
                    # Plain text format
                    lines = ["OpenPlaud Export\n", f"Generated: {datetime.now().isoformat()}\n\n"]
                    for transcription in transcriptions:
                        lines.append(f"---\n")
                        lines.append(f"ID: {transcription['id']}\n")
                        lines.append(f"Recording: {transcription['recording_id']}\n")
                        lines.append(f"\n{transcription['text']}\n\n")
                    export_content = "".join(lines)
                    filename = f"openplaud_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
                else:
                    st.warning(f"Format {format_type} not yet implemented")
                    return

                progress_bar.progress(100)
                status_text.empty()

                st.success("Export ready!")

                st.download_button(
                    label=f"⬇️ Download {format_type.upper()}",
                    data=export_content,
                    file_name=filename,
                    mime="text/plain" if format_type == "txt" else "application/json",
                )

            except Exception as e:
                st.error(f"Export failed: {e}")

    with tab2:
        st.subheader("Backup & Restore")

        col1, col2 = st.columns(2)

        with col1:
            if st.button("💾 Create Full Backup"):
                try:
                    progress_bar = st.progress(0)
                    status_text = st.empty()

                    status_text.text("Creating backup...")

                    # Get all data
                    response = requests.get(f"{API_BASE_URL}/api/recordings/")
                    recordings = response.json()

                    response = requests.get(f"{API_BASE_URL}/api/transcriptions/")
                    transcriptions = response.json()

                    response = requests.get(f"{API_BASE_URL}/api/settings/")
                    app_settings = response.json()

                    progress_bar.progress(50)

                    # Create backup file
                    backup_data = {
                        "backup_date": datetime.now().isoformat(),
                        "version": "0.1.0",
                        "recordings": recordings,
                        "transcriptions": transcriptions,
                        "settings": app_settings,
                    }

                    backup_content = json.dumps(backup_data, indent=2)
                    filename = f"openplaud_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"

                    progress_bar.progress(100)
                    st.success("Backup created!")

                    st.download_button(
                        label="⬇️ Download Backup",
                        data=backup_content,
                        file_name=filename,
                        mime="application/json",
                    )

                except Exception as e:
                    st.error(f"Backup creation failed: {e}")

        with col2:
            st.write("📂 Restore from backup")
            backup_file = st.file_uploader("Choose backup file", type=["json"])

            if backup_file and st.button("🔄 Restore"):
                try:
                    backup_data = json.load(backup_file)

                    st.warning("⚠️ This will overwrite all current data. Proceed with caution.")

                    if st.checkbox("I understand the risks"):
                        # TODO: Implement restore logic
                        st.info("Restore functionality coming soon")

                except Exception as e:
                    st.error(f"Failed to load backup file: {e}")

        st.markdown("---")
        st.subheader("Backup Schedule")

        backup_frequency = st.selectbox(
            "Automatic backups",
            ["never", "daily", "weekly", "monthly"],
        )

        if backup_frequency != "never":
            st.info(f"Automatic backups enabled: {backup_frequency}")
            if st.button("💾 Save Backup Schedule"):
                try:
                    response = requests.patch(
                        f"{API_BASE_URL}/api/settings/",
                        json={"backup_frequency": backup_frequency},
                    )
                    response.raise_for_status()
                    st.success("Backup schedule saved!")
                except Exception as e:
                    st.error(f"Failed to save backup schedule: {e}")
