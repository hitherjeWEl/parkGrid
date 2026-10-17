from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(title="ParkGrid API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SearchQuery(BaseModel):
    destination: str = Field(min_length=1)
    arrival_time: str = "1 Minute"
    search_mode: str
    vehicle_length: str
    latitude: float | None = None
    longitude: float | None = None


@app.get("/")
def read_root():
    return {"status": "ParkGrid is live!"}


@app.post("/api/search")
def find_parking(query: SearchQuery):
    if query.search_mode == "street":
        return {
            "type": "Live Street Space",
            "price": "Free",
            "message": (
                f"Found a tight spot near {query.destination} that fits "
                f"a {query.vehicle_length} vehicle."
            ),
            "latitude": query.latitude,
            "longitude": query.longitude,
        }

    return {
        "type": "Premium Shadowed Lot",
        "price": "₹80",
        "message": (
            f"Guaranteed underground slot reserved at {query.destination} "
            f"for your {query.vehicle_length} vehicle."
        ),
        "latitude": query.latitude,
        "longitude": query.longitude,
    }
