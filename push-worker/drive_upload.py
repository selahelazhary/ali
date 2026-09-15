"""Google Drive uploads for the worker.

The dashboard writes the picked image to /uploads as a data URL; this module
pushes it to Drive, makes it public and returns a direct image link, so photos
never sit inside the database.

First run opens a browser once to authorise this machine; the token is then
cached in token.json next to this file.

Setup (one time, in Google Cloud Console → APIs & Services):
  1. Enable "Google Drive API"
  2. Credentials → Create credentials → OAuth client ID → Desktop app
  3. Download the JSON and save it here as  client_secret.json
"""
import base64
import json
import os
import re

DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files"
DRIVE_FILES = "https://www.googleapis.com/drive/v3/files"
SCOPES = ["https://www.googleapis.com/auth/drive.file"]


class DriveUploader:
    def __init__(self, base_dir, folder_name="Daily Bake Images"):
        self.base_dir = base_dir
        self.folder_name = folder_name
        self.token_path = os.path.join(base_dir, "token.json")
        self.secret_path = os.path.join(base_dir, "client_secret.json")
        if not os.path.exists(self.secret_path):
            raise RuntimeError("محتاج client_secret.json (OAuth desktop) جنب worker.py")
        self.creds = self._auth()
        self._folder_id = None

    def _auth(self):
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow

        creds = None
        if os.path.exists(self.token_path):
            creds = Credentials.from_authorized_user_file(self.token_path, SCOPES)
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                flow = InstalledAppFlow.from_client_secrets_file(self.secret_path, SCOPES)
                creds = flow.run_local_server(port=0)
            with open(self.token_path, "w", encoding="utf-8") as fh:
                fh.write(creds.to_json())
        return creds

    def _session(self):
        from google.auth.transport.requests import AuthorizedSession
        return AuthorizedSession(self.creds)

    def folder_id(self):
        if self._folder_id:
            return self._folder_id
        s = self._session()
        q = f"name='{self.folder_name}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
        r = s.get(DRIVE_FILES, params={"q": q, "fields": "files(id)", "spaces": "drive"}, timeout=30).json()
        if r.get("files"):
            self._folder_id = r["files"][0]["id"]
        else:
            created = s.post(
                DRIVE_FILES,
                params={"fields": "id"},
                json={"name": self.folder_name, "mimeType": "application/vnd.google-apps.folder"},
                timeout=30,
            ).json()
            self._folder_id = created["id"]
        return self._folder_id

    def upload_data_url(self, data_url, name="image.png"):
        if not data_url or not data_url.startswith("data:"):
            raise ValueError("مش data URL صالح")
        header, b64data = data_url.split(",", 1)
        mime = re.match(r"data:([^;]+)", header).group(1)
        raw = base64.b64decode(b64data)

        s = self._session()
        meta = {"name": name, "parents": [self.folder_id()]}
        files = {
            "metadata": ("metadata", json.dumps(meta), "application/json"),
            "file": (name, raw, mime),
        }
        up = s.post(DRIVE_UPLOAD, params={"uploadType": "multipart", "fields": "id"}, files=files, timeout=120)
        up.raise_for_status()
        file_id = up.json()["id"]

        s.post(f"{DRIVE_FILES}/{file_id}/permissions", json={"role": "reader", "type": "anyone"}, timeout=30)
        return f"https://lh3.googleusercontent.com/d/{file_id}"
