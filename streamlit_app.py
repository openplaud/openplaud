import streamlit as st
import requests
import os
from api.config import settings

# Configure Streamlit
st.set_page_config(
    page_title="OpenPlaud",
    page_icon="🎙️",
    layout="wide",
    initial_sidebar_state="expanded",
)

# API base URL
API_BASE_URL = f"http://{settings.api_host}:{settings.api_port}"

# Sidebar navigation
st.sidebar.title("OpenPlaud")
st.sidebar.markdown("---")

page = st.sidebar.radio(
    "Navigation",
    [
        "🎙️ Dashboard",
        "📝 Transcribe",
        "⚙️ Settings",
        "📤 Export",
        "🔗 Plaud Connect",
    ],
)

st.sidebar.markdown("---")
st.sidebar.info("OpenPlaud - Self-hosted AI transcription for Plaud devices")

# Route to pages
if page == "🎙️ Dashboard":
    from pages.dashboard import show
    show()
elif page == "📝 Transcribe":
    from pages.transcribe import show
    show()
elif page == "⚙️ Settings":
    from pages.settings import show
    show()
elif page == "📤 Export":
    from pages.export import show
    show()
elif page == "🔗 Plaud Connect":
    from pages.plaud_connect import show
    show()
