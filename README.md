# Orwell - LLM Audit Platform

Orwell is an open-source platform designed to audit Large Language Models (LLMs) for cultural bias, policy compliance, and safety. It provides a standalone environment for researchers and developers to evaluate model outputs using the Orwell framework.

## Features

- **Interactive Audit Studio**: Run audits against target models using custom or predefined prompts.
- **Model Hub**: Configure and manage connections to various LLM providers (OpenRouter, Ollama, etc.).
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

3. **Start the Application:**
   ```bash
   docker-compose up -d
   ```

4. **Access the App:**
   - **Dashboard**: [http://localhost:8000](http://localhost:8000)

### Option 2: Local Development

1. **Setup Python Environment:**
   ```bash
   python -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```

2. **Configure Environment:**
   ```bash
   cp .env.example .env
   ```

3. **Run the Application:**
   ```bash
   ./start.sh
   ```

## Configuration

The application is configured via the `.env` file.

## Usage

1. **Add Models**: Go to "Model Hub" to configure target models (e.g., GPT-4, Ollama) and judge models.
2. **Run Audit**: Use the "Playground" to select dimensions, models, and run audits.
3. **Analyze**: View detailed reports in the "Data Studio".

## Security Note

- **Secrets**: Never commit your `.env` file. It is included in `.gitignore`.
- **Database**: The SQLite database is stored in `data/orwell.db`. Backup this directory to persist data.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

[MIT License](LICENSE)
