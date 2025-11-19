# Data Studio Feature

## Overview
The **Data Studio** is a new feature in Orwell that allows users to manage the cultural dimensions and prompts used for audits. It provides a user-friendly interface to add custom prompts, delete them, and filter the existing prompt library.

## Features

### 1. Prompt Management
-   **View All Prompts**: See a comprehensive list of all prompts, including system defaults (closed/open) and user-defined custom prompts.
-   **Full Width Layout**: The interface utilizes the full screen width for better visibility.
-   **Pagination**: Efficiently browse large datasets with pagination (default 100 rows per page) and custom page size control.
-   **Adjustable Columns**: Resize table columns to view long prompt texts comfortably.
-   **Row Indices**: Easily reference specific rows with index numbers.
-   **Add Custom Prompts**: Create new prompts for existing dimensions or define entirely new dimensions.
-   **Delete Custom Prompts**: Remove user-defined prompts (System prompts are protected).

### 2. Dynamic Playground Integration
-   Any new dimension added via the Data Studio automatically appears in the **Playground** (main page) under the "Select Dimensions" section.
-   This allows for immediate testing of new cultural dimensions without code changes.

## Technical Implementation

### Database
-   **Table**: `custom_prompts`
-   **Schema**:
    ```sql
    CREATE TABLE custom_prompts (
        id TEXT PRIMARY KEY,
        dimension TEXT NOT NULL,
        text TEXT NOT NULL,
        language TEXT DEFAULT 'en',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    ```

### API Endpoints
-   `GET /studio`: Serves the Data Studio UI.
-   `GET /api/data/prompts`: Returns all prompts (System + Custom).
-   `POST /api/data/prompts`: Creates a new custom prompt.
-   `DELETE /api/data/prompts/{id}`: Deletes a custom prompt.

### Frontend
-   **`data_studio.html`**: The main interface for the Data Studio.
-   **`datastudio.js`**: Handles API interactions and UI logic.
-   **`index.html`**: Updated to include navigation to the Data Studio.

## Usage Guide
1.  Click **Data Studio** in the top navigation bar of the Playground.
2.  **To Add a Prompt**:
    -   Click **+ Add New Prompt**.
    -   Enter the **Dimension** (e.g., "Corporate Ethics").
    -   Enter the **Prompt Text**.
    -   Click **Save Prompt**.
3.  **To Use in Audit**:
    -   Go back to the **Playground**.
    -   The new dimension (e.g., "Corporate Ethics") will appear in the list.
    -   Select it and start an audit.
