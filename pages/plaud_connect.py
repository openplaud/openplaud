import streamlit as st
import requests
from api.config import settings

API_BASE_URL = f"http://{settings.api_host}:{settings.api_port}"


def show():
    st.title("🔗 Plaud Connect")
    st.markdown("Connect your Plaud devices and sync recordings")

    tab1, tab2 = st.tabs(["Connection", "Devices"])

    with tab1:
        st.subheader("Plaud Account Connection")

        # Check current connection status
        try:
            response = requests.get(f"{API_BASE_URL}/api/plaud/connection")
            response.raise_for_status()
            has_connection = True
            connection = response.json()
        except:
            has_connection = False
            connection = None

        if has_connection:
            st.success("✅ Connected to Plaud")
            st.info(f"Last sync: {connection.get('last_sync', 'Never')}")

            if st.button("🔄 Sync Now"):
                try:
                    response = requests.post(f"{API_BASE_URL}/api/plaud/sync")
                    response.raise_for_status()
                    st.success("Sync started!")
                except Exception as e:
                    st.error(f"Sync failed: {e}")

            if st.button("🔌 Disconnect Plaud"):
                try:
                    response = requests.delete(f"{API_BASE_URL}/api/plaud/disconnect")
                    response.raise_for_status()
                    st.success("Disconnected from Plaud")
                    st.rerun()
                except Exception as e:
                    st.error(f"Disconnection failed: {e}")

        else:
            st.warning("❌ Not connected to Plaud")
            st.write("Connect your Plaud account to sync recordings")

            with st.form("plaud_connection_form"):
                st.markdown("### Get your bearer token")
                st.markdown("1. Visit [Plaud](https://plaud.ai)")
                st.markdown("2. Go to Settings → API")
                st.markdown("3. Copy your bearer token")

                bearer_token = st.text_input("Bearer Token", type="password")
                api_base = st.text_input(
                    "API Base URL (optional)",
                    value="https://api.plaud.ai",
                    help="Regional API server URL"
                )

                submitted = st.form_submit_button("🔗 Connect Plaud Account")

                if submitted:
                    if not bearer_token:
                        st.error("Bearer token is required")
                    else:
                        try:
                            data = {
                                "bearer_token": bearer_token,
                                "api_base": api_base,
                            }
                            response = requests.post(
                                f"{API_BASE_URL}/api/plaud/connect",
                                json=data,
                            )
                            response.raise_for_status()
                            st.success("✅ Successfully connected to Plaud!")
                            st.rerun()
                        except Exception as e:
                            st.error(f"Connection failed: {e}")

    with tab2:
        st.subheader("Your Plaud Devices")

        col1, col2 = st.columns([4, 1])

        with col2:
            if st.button("🔄 Refresh", key="refresh_devices"):
                st.rerun()

        try:
            response = requests.get(f"{API_BASE_URL}/api/plaud/devices")
            response.raise_for_status()
            devices = response.json()

            if not devices:
                st.info("No devices connected yet. Connect your Plaud account first.")
            else:
                for device in devices:
                    with st.container():
                        col1, col2, col3 = st.columns([2, 1, 1])

                        with col1:
                            st.write(f"**{device['name']}**")
                            st.caption(f"Model: {device['model']}")
                            st.caption(f"Serial: {device['serial_number']}")

                        with col2:
                            st.caption(f"Version: {device.get('version_number', 'Unknown')}")
                            st.caption(f"Added: {device['created_at'][:10]}")

                        with col3:
                            if st.button("🗑️ Remove", key=f"remove_device_{device['serial_number']}"):
                                try:
                                    response = requests.delete(
                                        f"{API_BASE_URL}/api/plaud/devices/{device['serial_number']}"
                                    )
                                    response.raise_for_status()
                                    st.success("Device removed")
                                    st.rerun()
                                except Exception as e:
                                    st.error(f"Failed to remove device: {e}")

                        st.divider()

        except requests.RequestException as e:
            st.warning(f"Failed to fetch devices: {e}")

        st.markdown("---")
        st.subheader("Sync Settings")

        col1, col2 = st.columns(2)

        with col1:
            auto_sync = st.checkbox("Auto-sync recordings", value=True)
            sync_interval = st.slider("Sync interval (minutes)", 1, 60, 5)

        with col2:
            sync_on_mount = st.checkbox("Sync on app startup", value=True)
            sync_notifications = st.checkbox("Notifications on sync", value=True)

        if st.button("💾 Save Sync Settings"):
            try:
                update_data = {
                    "auto_sync_enabled": auto_sync,
                    "sync_interval": sync_interval * 60 * 1000,
                    "sync_on_mount": sync_on_mount,
                    "sync_notifications": sync_notifications,
                }
                response = requests.patch(
                    f"{API_BASE_URL}/api/settings/",
                    json=update_data,
                )
                response.raise_for_status()
                st.success("Sync settings saved!")
            except Exception as e:
                st.error(f"Failed to save settings: {e}")
