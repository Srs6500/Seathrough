from fastapi import FastAPI, APIRouter

app = FastAPI()
router = APIRouter(prefix="/items")


@app.get("/health")
def health():
    return {"ok": True}


@router.get("/{item_id}")
def read_item(item_id: str):
    return {"id": item_id}


app.include_router(router)
