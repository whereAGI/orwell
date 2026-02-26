# Orwell - LLM Audit Platform

Orwell is an open-source platform designed to audit Large Language Models (LLMs) for cultural bias, policy compliance, and safety. It provides a standalone environment for researchers and developers to evaluate model outputs using the LLM-GLOBE framework.

## Features

- **Interactive Audit Studio**: Run audits against target models using custom or predefined prompts.
- **Model Management**: Configure and manage connections to various LLM providers (OpenAI, Ollama, etc.).
- **Data Studio**: Visualize and analyze audit results.
- **Standalone Deployment**: easy deployment via Docker or local setup.
- **Secure Architecture**: Environment-based configuration and secure secret management.

## Prerequisites

- **Docker & Docker Compose** (Recommended for deployment)
- **Python 3.11+** (For local development)

## Getting Started

### Option 1: Docker (Recommended)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/orwell.git
   cd orwell
   ```

2. **Configure Environment:**
   Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` to set your desired credentials and configuration.
   *Note: For remote deployment, update `PUBLIC_POCKETBASE_URL` in `.env` to your server's IP/domain.*

3. **Start the Application:**
   ```bash
   docker-compose up -d
   ```

4. **Access the App:**
   - **Dashboard**: [http://localhost:8000](http://localhost:8000)
   - **PocketBase Admin**: [http://localhost:8090/_/](http://localhost:8090/_/)

### Option 2: Local Development

1. **Setup Python Environment:**
   ```bash
   python -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```

2. **Download PocketBase:**
   Download the PocketBase binary for your OS from [pocketbase.io](https://pocketbase.io/docs/) and place it in the project root.
   *Note: The project includes a helper script `setup_pb.py` to initialize collections if needed, but the app handles this automatically.*

3. **Configure Environment:**
   ```bash
   cp .env.example .env
   ```

4. **Run the Application:**
   Use the startup script to launch both PocketBase and the FastAPI app:
   ```bash
   ./start.sh
   ```

## Configuration

The application is configured via the `.env` file. Key variables include:

- `ADMIN_EMAIL` / `ADMIN_PASSWORD`: Credentials for the initial admin user.
- `PUBLIC_POCKETBASE_URL`: The URL where the frontend can reach PocketBase (browser-accessible).
- `POCKETBASE_URL`: Internal URL for backend communication (usually `http://127.0.0.1:8090` or `http://pocketbase:8090` in Docker).

## Usage

1. **Login**: Use the admin credentials defined in your `.env` file.
2. **Add Models**: Go to "Model Studio" to configure target models (e.g., GPT-4, Ollama) and judge models.
3. **Run Audit**: Use the "Playground" to select dimensions, models, and run audits.
4. **Analyze**: View detailed reports in the "Data Studio".

## Security Note

- **Secrets**: Never commit your `.env` file. It is included in `.gitignore`.
- **Production**: For public deployment, ensure you change the default `ADMIN_PASSWORD` and `SECRET_KEY` (if applicable).
- **Database**: The SQLite database is stored in `pb_data/`. Backup this directory to persist data.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

[MIT License](LICENSE)
