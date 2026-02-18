# Orwell Model Studio - Execution Plan & Checklist

This document outlines the detailed plan for implementing the **Model Studio** feature, which allows users to manage Target and Judge models (OpenAI, OpenRouter, Ollama, Custom) and select them from dropdowns in the Playground.

---

## 1. Database Schema Update (PocketBase)

We need a new collection `models` to store model configurations.

### **Task 1.1: Create Schema Update Script**
Create `update_model_schema.py` to add the `models` collection.

**Collection Name:** `models`

**Fields:**
| Name | Type | Options | Description |
|---|---|---|---|
| `name` | Text | Required | Display name (e.g., "Production GPT-4o") |
| `category` | Select | Required | Options: `target`, `judge` |
| `provider` | Select | Required | Options: `openai`, `openrouter`, `ollama`, `custom` |
| `base_url` | Text | Required | API Endpoint (e.g., `https://api.openai.com/v1`) |
| `model_key` | Text | Required | The model ID string (e.g., `gpt-4o-mini`) |
| `api_key` | Text | Optional | Encrypted/Stored API Key (optional for local models) |

**Code Snippet (`update_model_schema.py`):**
```python
import asyncio
from orwell.pb_client import get_pb

async def create_models_collection():
    print("Checking 'models' collection...")
    pb = get_pb()
    
    try:
        try:
            pb.collections.get_one("models")
            print("'models' collection already exists.")
        except:
            print("Creating 'models' collection...")
            pb.collections.create({
                "name": "models",
                "type": "base",
                "schema": [
                    {"name": "name", "type": "text", "required": True},
                    {"name": "category", "type": "select", "required": True, "options": {"values": ["target", "judge"]}},
                    {"name": "provider", "type": "select", "required": True, "options": {"values": ["openai", "openrouter", "ollama", "custom"]}},
                    {"name": "base_url", "type": "text", "required": True},
                    {"name": "model_key", "type": "text", "required": True},
                    {"name": "api_key", "type": "text", "required": False}
                ]
            })
            print("'models' collection created.")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(create_models_collection())
```

---

## 2. Backend Implementation (FastAPI)

### **Task 2.1: Update Pydantic Models**
Modify `orwell/models.py` to include a `ModelConfig` and update `AuditRequest` to accept model IDs.

**Code Snippet (`orwell/models.py`):**
```python
class ModelConfig(BaseModel):
    id: str
    name: str
    category: str  # target, judge
    provider: str
    base_url: str
    model_key: str
    api_key: Optional[str] = None

class AuditRequest(BaseModel):
    # Support selecting stored models
    target_model_id: Optional[str] = None
    judge_model_id: Optional[str] = None
    
    # Fallback / Custom / Legacy fields
    target_endpoint: Optional[HttpUrl] = None
    api_key: Optional[str] = ""
    model_name: Optional[str] = None
    judge_model: str = "gpt-4o"  # Kept for backward compatibility if judge_model_id is not set
    
    # ... existing fields (language, sample_size, etc.)
```

### **Task 2.2: Update Judge Client**
Modify `orwell/judge.py` to accept a custom `base_url` so it can work with providers other than OpenAI (e.g., Ollama, OpenRouter).

**Code Snippet (`orwell/judge.py`):**
```python
class JudgeClient:
    def __init__(self, model: str, api_key: str | None, base_url: str | None = None):
        self.model = model
        self.api_key = api_key or os.getenv("ORWELL_API_KEY") or os.getenv("OPENAI_API_KEY")
        self.base_url = base_url
        
        # Initialize AsyncOpenAI with custom base_url if provided
        self.client = AsyncOpenAI(
            api_key=self.api_key,
            base_url=self.base_url
        ) if self.api_key else None
```

### **Task 2.3: Implement Model Endpoints**
Add CRUD endpoints to `orwell/main.py` for managing models.

**Code Snippet (`orwell/main.py`):**
```python
@app.get("/api/models", response_model=List[ModelConfig])
async def list_models(category: Optional[str] = None):
    pb = get_pb()
    query_params = {"sort": "name"}
    if category:
        query_params["filter"] = f'category="{category}"'
    
    records = pb.collection("models").get_full_list(query_params=query_params)
    return [
        ModelConfig(
            id=r.id,
            name=r.name,
            category=r.category,
            provider=r.provider,
            base_url=r.base_url,
            model_key=r.model_key,
            # Don't return full API key for security in list view if possible, 
            # but for this POC we might need it or handle it securely on backend
            api_key=r.api_key 
        ) for r in records
    ]

@app.post("/api/models", response_model=ModelConfig)
async def create_model(config: ModelConfig):
    pb = get_pb()
    # Create record ...
    # Return created model
```

### **Task 2.4: Update Audit Creation Logic**
Modify `create_audit` in `orwell/main.py` to fetch model details if an ID is provided.

**Logic:**
1. If `request.target_model_id` is set:
   - Fetch model record from DB.
   - Override `request.target_endpoint`, `request.api_key`, `request.model_name` with values from the record.
2. If `request.judge_model_id` is set:
   - Fetch judge record from DB.
   - Pass these details (endpoint, key) to `AuditEngine`.

**Code Snippet (`orwell/engine.py` / `orwell/main.py`):**
*Note: We need to pass the Judge's endpoint/key to the engine, which currently only takes `judge_model` name.*
*Update `AuditRequest` or `AuditEngine.execute_audit` signature to accept `judge_config`.*

---

## 3. Frontend Implementation

### **Task 3.1: Create Model Studio Page**
Create `static/model_studio.html`.
- **Tabs**: "Target Models" | "Judge Models"
- **List**: Table showing Name, Provider, Model Key.
- **Add Button**: Opens a modal/form.

**Form Fields:**
- Name (Text)
- Provider (Dropdown: OpenAI, OpenRouter, Ollama, Custom)
- Base URL (Auto-filled based on provider, editable for Custom)
- Model Key (Text)
- API Key (Password)

### **Task 3.2: Implement Model Studio Logic**
Create `static/modelstudio.js`.
- Fetch models on load.
- Handle Tab switching (filter list by category).
- Handle Form submission (POST /api/models).
- Handle Delete (DELETE /api/models/{id}).

### **Task 3.3: Update Playground UI**
Modify `static/index.html`.
- Add "Model Studio" link in header.
- **Target Section**:
  - Replace raw inputs with `<select id="targetModelSelect">`.
  - Options: [Loaded Models...] + "Custom".
  - If "Custom" is selected, show the old `endpoint`, `apiKey`, `modelName` inputs.
- **Judge Section**:
  - Add `<select id="judgeModelSelect">`.
  - Options: [Loaded Judge Models...] + "Default (GPT-4o)".

### **Task 3.4: Update Playground Logic**
Modify `static/dashboard.js`.
- On load, fetch models from `/api/models`.
- Populate dropdowns.
- Toggle visibility of "Custom" fields based on selection.
- Update `startBtn` click handler to send `target_model_id` / `judge_model_id` if a saved model is selected.

---

## 4. Execution Checklist

### Phase 1: Database & Backend
- [ ] Run `update_model_schema.py` to create `models` collection.
- [ ] Update `orwell/models.py` with `ModelConfig` and new `AuditRequest` fields.
- [ ] Update `orwell/judge.py` to support `base_url`.
- [ ] Update `orwell/main.py` with `/api/models` endpoints.
- [ ] Update `create_audit` logic in `orwell/main.py` to resolve model IDs.
- [ ] Update `orwell/engine.py` to use resolved Judge configuration.

### Phase 2: Frontend - Model Studio
- [ ] Create `static/model_studio.html`.
- [ ] Create `static/modelstudio.js`.
- [ ] Add navigation link in `static/index.html` header.

### Phase 3: Frontend - Playground Integration
- [ ] Modify `static/index.html` sidebar to use Dropdowns for Target/Judge.
- [ ] Update `static/dashboard.js` to fetch models and handle selection logic.
- [ ] Test "Custom" mode (backward compatibility).
- [ ] Test "Saved Model" mode (Target & Judge).

### Phase 4: Verification
- [ ] Add a model via Model Studio (e.g., an OpenRouter model).
- [ ] Run an audit using the saved model.
- [ ] Verify the audit runs successfully and uses the correct endpoint/key.
