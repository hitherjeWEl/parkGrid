# ParkGrid

A React + Vite parking-search frontend with a FastAPI backend and Leaflet map.

## 1. Frontend

```bash
npm install
npm run dev
```

Open the URL shown by Vite, normally `http://localhost:5173`.

## 2. Backend

Create a Python virtual environment and install the API dependencies:

```bash
python -m venv .venv
```

Windows PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

macOS/Linux:

```bash
source .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Run the frontend and backend in separate VS Code terminals.

## 3. Build

```bash
npm run build
```

## Notes

- Location autocomplete uses OpenStreetMap Nominatim.
- The backend currently returns demo parking results; replace `find_parking()` with the real parking-data logic when available.
- `VITE_API_URL` can be set in a local `.env` file if the API runs somewhere other than `127.0.0.1:8000`.
