# autodromo-backend

API REST para el Sistema de Registro de Pilotos — Autódromo Monterrey.

## Stack
- Node.js + Express.js
- MySQL 2 (sin ORM)
- JWT + bcryptjs
- Deploy: Railway

## Estructura
```
backend/
├── configuracion/
│   └── db.js          ← Pool de conexión MySQL
└── server.js          ← Servidor + todas las rutas
```

## Instalación local

```bash
npm install
```

Crea un archivo `.env` basándote en `.env.example`:

```bash
cp .env.example .env
# Edita .env con tus credenciales MySQL locales
```

```bash
node server.js
# o en desarrollo:
npx nodemon server.js
```

Las tablas y datos iniciales se crean automáticamente al arrancar.

## Variables de entorno (Railway)

Railway las inyecta automáticamente al conectar el plugin de MySQL:

| Variable          | Descripción              |
|-------------------|--------------------------|
| `MYSQLHOST`       | Host de la base de datos |
| `MYSQLUSER`       | Usuario MySQL            |
| `MYSQLPASSWORD`   | Contraseña MySQL         |
| `MYSQLDATABASE`   | Nombre de la base de datos |
| `MYSQLPORT`       | Puerto (default 3306)    |
| `JWT_SECRET`      | Clave secreta para JWT   |
| `FRONTEND_URL`    | URL de GitHub Pages (CORS) |
| `PORT`            | Puerto del servidor (Railway lo asigna) |

## Deploy en Railway

1. Sube este repositorio a GitHub como `autodromo-backend`
2. En Railway → New Project → Deploy from GitHub repo
3. Conecta el plugin de MySQL (Railway lo crea y llena las variables automáticamente)
4. Agrega manualmente `JWT_SECRET` y `FRONTEND_URL`
5. Railway detecta el `package.json` y ejecuta `npm start`

## Credenciales por defecto (generadas al primer arranque)

| Usuario        | Contraseña  | Rol           |
|----------------|-------------|---------------|
| admin          | Admin123!   | Administrador |
| inscripciones  | Inscri123!  | Inscripciones |
| torre          | Torre123!   | Torre control |

**Cambia las contraseñas en producción.**

## Endpoints principales

```
POST   /api/auth/login
GET    /api/auth/yo

GET    /api/pilotos
POST   /api/pilotos
PUT    /api/pilotos/:id

GET    /api/carreras
POST   /api/carreras

GET    /api/categorias

GET    /api/inscripciones
POST   /api/inscripciones
PATCH  /api/inscripciones/:id/pagar
POST   /api/inscripciones/auto-registro   ← público, sin token

GET    /api/reportes/por-categoria
GET    /api/reportes/corte-general        ← solo admin

GET    /api/usuarios                      ← solo admin
POST   /api/usuarios                      ← solo admin
```
