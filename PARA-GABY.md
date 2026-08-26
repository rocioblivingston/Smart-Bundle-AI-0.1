# Cómo seguir vos con esto

Hay una versión más larga y con más contexto de esto en `docs/guia-deploy.html` — abrila
en el navegador. Esto de acá es el resumen.

Este repo arrancó como un prototipo que armamos para probar si tu idea de Smart Bundle AI
se sostiene técnicamente. La respuesta es: sí, con dos ajustes (están explicados en el
README y en el commit `fix(core): substitute must match product type...` — leélo, ahí está
el razonamiento). El núcleo del producto (`packages/core`) está construido, testeado y
funcionando.

**El código ya está preparado para ponerlo online sin tener tu computadora prendida.** Falta crear
los dos servicios en tus cuentas de Render y Vercel y cargar sus variables de entorno.

## Por qué no está ya deployado

El frontend ya no tiene una API de producción fija. En local usa `http://localhost:3001` solo cuando
se sirve por separado; en Vercel el build genera `config.js` a partir de `VITE_API_URL`.

## Lo que tenés que resolver (en este orden)

1. **Crear la API en Render desde la raíz del repositorio.** Build:
   `npm ci && npm run build:api`; start: `npm start --workspace=@sba/api`; healthcheck: `/health`.

2. **Cargar las variables de Render.** `ECOMMERCE_PROVIDER=lenaldi`, `GEMINI_API_KEY`,
   `LENALDI_WHATSAPP_NUMBER`, `LENALDI_CACHE_TTL_SECONDS=900`. `FRONTEND_ORIGIN` se completa
   después de crear Vercel.

3. **La `GEMINI_API_KEY` es opcional para que la aplicación no se caiga.** Si no la configurás en el
   servicio de deploy, el sistema sigue funcionando con las reglas fijas (`StubIntentParser`,
   `StubExplainer`), pero para demostrar Gemini real sí hay que cargarla en Render.

4. **Crear el frontend en Vercel desde la raíz del repositorio.** Build: `npm run build:web`;
   output: `dist/web`; variable: `VITE_API_URL=https://TU-API.onrender.com`.

5. **Volver a Render** y configurar `FRONTEND_ORIGIN=https://TU-FRONT.vercel.app`. La URL de Vercel,
   no la de Render, es la que se coloca en Lenaldi.

## Una trampa real que ya encontramos por vos

`loadCatalog()` en `packages/api/src/app.ts` originalmente leía el catálogo con
`fs.readFileSync` sobre una ruta armada en el momento. Eso funciona perfecto en tu
máquina y se rompe silenciosamente en un entorno serverless, porque esas plataformas
arman el paquete a deployar siguiendo los `import`, no rastreando qué archivos lee
`fs` en tiempo de ejecución. Ya lo arreglamos (ahora es un `import` estático del JSON),
pero es el tipo de cosa que vale la pena que entiendas *por qué* rompía, no solo que
ya no rompe — te va a volver a pasar con otros archivos si no tenés el patrón en la cabeza.

## Si te trabás

Guardate el mensaje de error completo, buscalo tal cual (no la versión resumida que vos
armás de memoria), y si después de un rato de buscar seguís sin entender qué pide la
plataforma — preguntame. Pero probá primero: es la parte del ejercicio que más rinde.
