# Atlas Wealth

## Personal Investment Operating System

Atlas Wealth is a comprehensive wealth management platform built for individuals who want to treat their personal trading and investing as a serious business. It integrates performance tracking, robust research workflows, strategy backtesting, and controlled execution into a single operating system.

## Key Modules

1. **Performance Tracker**: Real-time account aggregation, net worth visualization, and deep performance analytics (returns, attribution, drawdowns).
2. **Research Workspace**: Structured thesis development, evidence collection, and a decision journal to track your thinking over time.
3. **Strategy & Backtesting**: A rule-based strategy builder with a powerful backtesting engine to validate ideas before risking capital.
4. **Execution & Trade Management**: Controlled order planning and execution with pre-trade compliance and constraint-based guardrails.

## Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org/) (App Router, Server Components)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/)
- **UI Components**: [shadcn/ui](https://ui.shadcn.com/) + [Radix UI](https://www.radix-ui.com/)
- **State Management**: [TanStack Query](https://tanstack.com/query/latest) (Server) + [Zustand](https://github.com/pmndrs/zustand) (Client)
- **Charts**: [Recharts](https://recharts.org/) + [Lightweight Charts](https://tradingview.github.io/lightweight-charts/)
- **Database/ORM**: PostgreSQL (via Docker)
- **Containerization**: Docker & Docker Compose

## Getting Started

### Prerequisites

- Node.js 20+
- Docker & Docker Compose

### Local Development

1. **Clone the repository:**

    ```bash
    git clone <repository-url>
    cd Portfolio-Manager
    ```

2. **Install dependencies:**

    ```bash
    npm install
    ```

3. **Run the development server:**

    ```bash
    npm run dev
    ```

    Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### Running with Docker

1. **Build and start the services:**

    ```bash
    docker-compose up -d --build
    ```

    This will start the Next.js application and any configured services (e.g., PostgreSQL).

2. **Access the application:**
    Open [http://localhost:3000](http://localhost:3000).

3. **Stop services:**

    ```bash
    docker-compose down
    ```

## Documentation

- [UX Prototype Specification](docs/Atlas-Wealth-UX-Prototype-Spec.md): Detailed breakdown of every page, component, and interaction.
- [Developer Guide (CLAUDE.md)](docs/CLAUDE.md): Coding conventions, project structure, and development workflows.

## Project Structure

The project follows a feature-based architecture within `src/app` and `src/components`.

- `src/app`: Next.js App Router pages (Dashboard, Portfolios, Research, Strategies, Execution).
- `src/components`: Reusable UI components, categorized by domain (e.g., `features/research`) and type (e.g., `ui/` for basic primitives).
