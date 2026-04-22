import streamlit as st
import requests
import io
from api.config import settings

API_BASE_URL = f"http://{settings.api_host}:{settings.api_port}"


def show():
    st.title("📝 Transcribe")
    st.markdown("Transcribe audio files to text")

    tab1, tab2 = st.tabs(["Upload & Transcribe", "Recent Transcriptions"])

    with tab1:
        st.subheader("Upload Audio")
        uploaded_file = st.file_uploader(
            "Choose an audio file",
            type=["wav", "mp3", "m4a", "aac", "flac", "ogg"],
        )

        if uploaded_file:
            st.audio(uploaded_file)

            col1, col2 = st.columns(2)

            with col1:
                transcription_type = st.radio(
                    "Transcription Method",
                    ["local", "api"],
                    format_func=lambda x: {"local": "Local (Whisper)", "api": "API-based"}[x],
                )

            with col2:
                language = st.selectbox(
                    "Language (or auto-detect)",
                    [None, "en", "es", "fr", "de", "it", "ja", "zh"],
                    format_func=lambda x: "Auto-detect" if x is None else x,
                )

            if st.button("🚀 Transcribe", key="transcribe_button"):
                progress_bar = st.progress(0)
                status_text = st.empty()

                try:
                    status_text.text("Preparing audio...")
                    audio_data = uploaded_file.read()

                    status_text.text("Transcribing...")
                    progress_bar.progress(50)

                    # TODO: Call API to transcribe
                    # For now, show a placeholder
                    st.success("Transcription complete!")
                    st.text_area(
                        "Transcription Result",
                        value="(Placeholder transcription result would appear here)",
                        height=200,
                        disabled=True,
                    )

                    progress_bar.progress(100)

                except Exception as e:
                    st.error(f"Transcription failed: {e}")

    with tab2:
        st.subheader("Recent Transcriptions")

        try:
            response = requests.get(f"{API_BASE_URL}/api/transcriptions/")
            response.raise_for_status()
            transcriptions = response.json()

            if not transcriptions:
                st.info("No transcriptions yet. Upload an audio file to get started.")
            else:
                for transcription in transcriptions[-5:]:  # Show last 5
                    with st.expander(f"📄 {transcription['model']} - {transcription['created_at'][:10]}"):
                        st.text_area(
                            "Text",
                            value=transcription["text"],
                            height=150,
                            disabled=True,
                            key=transcription["id"],
                        )
                        col1, col2, col3 = st.columns(3)
                        with col1:
                            st.caption(f"Provider: {transcription['provider']}")
                        with col2:
                            st.caption(f"Model: {transcription['model']}")
                        with col3:
                            if st.button("📋 Copy", key=f"copy_{transcription['id']}"):
                                st.success("Copied to clipboard!")

        except requests.RequestException as e:
            st.error(f"Failed to fetch transcriptions: {e}")
