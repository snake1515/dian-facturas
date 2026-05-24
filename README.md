# FacturaDIAN — Guía completa de despliegue

Sistema de gestión de facturas electrónicas DIAN con integración Gmail, parser XML UBL 2.1, roles de usuario y sincronización automática.

---

## PASO 1 — Crear credenciales Gmail en Google Cloud Console

### 1.1 Crear el proyecto
1. Ve a https://console.cloud.google.com
2. Haz clic en el selector de proyectos (arriba a la izquierda) → **Nuevo proyecto**
3. Nombre: `FacturaDIAN` → **Crear**
4. Asegúrate de tener ese proyecto seleccionado

### 1.2 Habilitar la API de Gmail
1. En el menú izquierdo → **APIs y servicios** → **Biblioteca**
2. Busca `Gmail API` → haz clic → **Habilitar**

### 1.3 Configurar pantalla de consentimiento OAuth
1. **APIs y servicios** → **Pantalla de consentimiento de OAuth**
2. Tipo de usuario: **Externo** → **Crear**
3. Completa:
   - Nombre de la app: `FacturaDIAN`
   - Correo de soporte: tu correo
   - Correo del desarrollador: tu correo
4. Haz clic en **Guardar y continuar** en cada sección hasta terminar
5. En la sección **Usuarios de prueba** → **Agregar usuarios** → escribe el correo Gmail que vas a enlazar
6. **Guardar y continuar** → **Volver al panel**

### 1.4 Crear credenciales OAuth
1. **APIs y servicios** → **Credenciales** → **Crear credenciales** → **ID de cliente de OAuth**
2. Tipo: **Aplicación web**
3. Nombre: `FacturaDIAN Web`
4. En **URIs de redireccionamiento autorizados** agrega:
   ```
   https://TU-BACKEND.onrender.com/api/gmail/callback
   ```
   (Reemplaza con la URL real de tu backend en Render)
5. **Crear**
6. Copia y guarda:
   - **ID de cliente** → esto es `GMAIL_CLIENT_ID`
   - **Secreto del cliente** → esto es `GMAIL_CLIENT_SECRET`

---

## PASO 2 — Subir el código a GitHub

```bash
# En la carpeta del proyecto
cd dian-facturas

git init
git add .
git commit -m "Initial commit - FacturaDIAN"

# Crea un repositorio en github.com y conecta:
git remote add origin https://github.com/TU-USUARIO/dian-facturas.git
git push -u origin main
```

---

## PASO 3 — Desplegar en Render

### 3.1 Crear la base de datos PostgreSQL
1. Ve a https://dashboard.render.com
2. **New** → **PostgreSQL**
3. Nombre: `dian-facturas-db`
4. Plan: **Free** (suficiente para empezar)
5. **Create Database**
6. Copia la **Internal Database URL** (la usarás en el backend)

### 3.2 Desplegar el backend
1. **New** → **Web Service**
2. Conecta tu repositorio GitHub (`dian-facturas`)
3. Configura:
   - **Name**: `dian-facturas-backend`
   - **Root Directory**: `backend`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free
4. En **Environment Variables** agrega:

   | Clave | Valor |
   |-------|-------|
   | `DATABASE_URL` | La URL copiada del paso 3.1 |
   | `JWT_SECRET` | Una cadena aleatoria segura (ej: `openssl rand -hex 32`) |
   | `GMAIL_CLIENT_ID` | El que obtuviste en Google Cloud |
   | `GMAIL_CLIENT_SECRET` | El que obtuviste en Google Cloud |
   | `GMAIL_REDIRECT_URI` | `https://dian-facturas-backend.onrender.com/api/gmail/callback` |
   | `GMAIL_USER` | El correo Gmail que vas a enlazar |
   | `FRONTEND_URL` | `https://dian-facturas-frontend.onrender.com` (ajusta después) |
   | `NODE_ENV` | `production` |

5. **Create Web Service**
6. Espera a que termine el deploy. Copia la URL (ej: `https://dian-facturas-backend.onrender.com`)

### 3.3 Desplegar el frontend
1. **New** → **Static Site**
2. Conecta el mismo repositorio
3. Configura:
   - **Name**: `dian-facturas-frontend`
   - **Root Directory**: `frontend`
   - **Build Command**: `npm install && npm run build`
   - **Publish Directory**: `build`
4. En **Environment Variables**:

   | Clave | Valor |
   |-------|-------|
   | `REACT_APP_API_URL` | `https://dian-facturas-backend.onrender.com/api` |

5. **Create Static Site**
6. Copia la URL del frontend (ej: `https://dian-facturas-frontend.onrender.com`)

### 3.4 Actualizar FRONTEND_URL en el backend
1. Ve al Web Service del backend en Render
2. **Environment** → edita `FRONTEND_URL` con la URL real del frontend
3. **Save Changes** (se redespliega automáticamente)

---

## PASO 4 — Crear el primer usuario administrador

Una vez desplegado, crea el usuario admin vía API (solo funciona cuando no hay ningún usuario):

```bash
curl -X POST https://dian-facturas-backend.onrender.com/api/auth/usuarios \
  -H "Content-Type: application/json" \
  -d '{
    "nombre": "Tu Nombre",
    "email": "admin@tuempresa.com",
    "password": "contraseña_segura"
  }'
```

O puedes usar Postman/Insomnia con el mismo body.

El primer usuario creado es automáticamente **administrador**.

---

## PASO 5 — Conectar Gmail

1. Inicia sesión en la app con el usuario admin
2. Ve a **Configuración** → **Correo Gmail**
3. Haz clic en **Vincular cuenta Gmail**
4. Autoriza el acceso con la cuenta Gmail que recibe las facturas
5. Serás redirigido de vuelta a la app con Gmail conectado
6. Haz clic en **Sincronizar ahora** para importar las facturas existentes

---

## PASO 6 — Volver a Google Cloud y actualizar la URI

Si la URL de Render que obtuviste es diferente a la que pusiste en el paso 1.4, actualízala:
1. **Google Cloud Console** → **Credenciales** → tu cliente OAuth
2. Edita la URI de redireccionamiento con la URL correcta del backend
3. **Guardar**

---

## Uso de la aplicación

### Flujo normal de facturas
1. Cada N horas (configurable), el sistema revisa el Gmail automáticamente
2. Los correos con adjuntos XML DIAN se procesan y la factura aparece en la lista
3. Puedes asignar **responsables** a cada factura (correos para reenvío)
4. Al hacer **Reenviar**, la factura se envía con PDF y XML adjuntos
5. El estado cambia a "Reenviado" y queda registrado a quién se envió

### Borrado masivo
- Solo el admin puede borrar por rango de fechas
- Ve al listado → **Borrar por fechas** → selecciona rango → confirmar

### Usuarios de consulta
- Pueden ver todas las facturas y responsables
- Pueden reenviar facturas
- **No** pueden eliminar ni acceder a configuración

---

## Prueba local con Docker

```bash
# Copia y configura las variables de entorno
cp backend/.env.example backend/.env
# Edita backend/.env con tus credenciales de Gmail

# Levanta todo
docker-compose up --build

# La app estará en http://localhost:3000
# El backend en http://localhost:3001
```

---

## Estructura del proyecto

```
dian-facturas/
├── backend/
│   ├── src/
│   │   ├── index.js              # Servidor principal + cron
│   │   ├── models/db.js          # PostgreSQL + esquema
│   │   ├── middleware/auth.js    # JWT + roles
│   │   ├── routes/
│   │   │   ├── auth.js           # Login, usuarios
│   │   │   ├── facturas.js       # CRUD facturas, reenvío, descarga
│   │   │   ├── gmail.js          # OAuth2, sync, status
│   │   │   └── configuracion.js  # Settings admin
│   │   └── services/
│   │       ├── gmailService.js   # Polling Gmail + procesamiento
│   │       ├── xmlParser.js      # Parser XML DIAN UBL 2.1
│   │       └── emailService.js   # Reenvío con nodemailer
│   └── uploads/                  # PDFs y XMLs almacenados
├── frontend/
│   └── src/
│       ├── App.js                # Router + Layout + Sidebar
│       ├── context/AuthContext.js
│       ├── services/api.js       # Axios + todos los endpoints
│       └── pages/
│           ├── Login.js
│           ├── Facturas.js       # FE y NC (mismo componente)
│           ├── Usuarios.js
│           └── Configuracion.js
└── docker-compose.yml
```
