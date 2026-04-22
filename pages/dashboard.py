import streamlit as st
import requests
from datetime import datetime
from api.config import settings

API_BASE_URL = f"http://{settings.api_host}:{settings.api_port}"


def show():
    st.title("🎙️ Dashboard")
    st.markdown("View and manage your recordings")

    # Tabs for different views
    tab1, tab2 = st.tabs(["Recordings", "Statistics"])

    with tab1:
        col1, col2, col3 = st.columns([2, 1, 1])

        with col1:
            search = st.text_input("🔍 Search recordings", "")

        with col2:
            sort = st.selectbox(
                "Sort by",
                ["newest", "oldest", "name"],
                format_func=lambda x: {"newest": "Newest First", "oldest": "Oldest First", "name": "Name"}[x],
            )

        with col3:
            limit = st.selectbox("Show", [25, 50, 100], index=1)

        # Fetch recordings
        try:
            params = {
                "skip": 0,
                "limit": limit,
                "sort": sort,
                "search": search,
            }
            response = requests.get(f"{API_BASE_URL}/api/recordings/", params=params)
            response.raise_for_status()
            recordings = response.json()

            if not recordings:
                st.info("No recordings found. Sync your Plaud device to get started.")
            else:
                # Display recordings in a table
                for recording in recordings:
                    with st.container():
                        col1, col2, col3, col4 = st.columns([2, 2, 1, 1])

                        with col1:
                            st.write(f"**{recording['filename']}**")
                            st.caption(recording["device_sn"])

                        with col2:
                            start = datetime.fromisoformat(recording["start_time"].replace("Z", "+00:00"))
                            st.write(f"📅 {start.strftime('%Y-%m-%d %H:%M:%S')}")
                            duration_mins = recording["duration"] // 60000
                            st.caption(f"Duration: {duration_mins}m {recording['duration'] % 60000 // 1000}s")

                        with col3:
                            if st.button("📝 Transcribe", key=recording["id"]):
                                st.session_state.selected_recording = recording
                                st.switch_page("pages/transcribe.py")

                        with col4:
                            if st.button("🗑️", key=f"delete_{recording['id']}"):
                                requests.delete(f"{API_BASE_URL}/api/recordings/{recording['id']}")
                                st.rerun()

                        st.divider()

        except requests.RequestException as e:
            st.error(f"Failed to fetch recordings: {e}")

    with tab2:
        try:
            response = requests.get(f"{API_BASE_URL}/api/recordings/stats/count")
            response.raise_for_status()
            stats = response.json()

            col1, col2, col3 = st.columns(3)

            with col1:
                st.metric("Total Recordings", stats.get("total", 0))

            with col2:
                # Calculate total duration (would need sum endpoint)
                st.metric("Total Duration", "N/A hours")

            with col3:
                st.metric("Storage Used", "N/A GB")

        except requests.RequestException as e:
            st.error(f"Failed to fetch statistics: {e}")
