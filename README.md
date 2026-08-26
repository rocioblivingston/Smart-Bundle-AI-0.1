# Smart Bundle AI — prototipo

A partir de la idea de Gaby ("Smart Bundle Optimizer for E-commerce"): el comprador dice qué
necesita y cuánto tiene para gastar, el sistema arma el combo que más aprovecha ese presupuesto
sin pasarse ni un peso, y si algo no tiene stock lo reemplaza por un producto equivalente.

## Cómo está armado

```
packages/
├─ core/    lógica de negocio pura — sin Express, sin n8n, sin SDK de proveedor
├─ api/     servidor HTTP, adaptadores Carrefour/VTEX y Lenaldi, y fallback local
└─ web/     página estática (HTML/CSS/JS sin build) que llama a la API
n8n/         workflow importable: Webhook → HTTP Request → Respond
```

`core` es donde vive todo lo que se puede probar sin infraestructura: el algoritmo que arma el
combo, la sustitución por falta de stock, y el parser de intención con su fallback determinístico.
Es el mismo criterio que usamos en TrackIO — la lógica de negocio no depende de qué la vaya a
llamar (Express hoy, n8n mañana, lo que sea después).

## Dos correcciones importantes sobre la idea original

**Armar el combo no es un trabajo para una IA.** Es el problema clásico de la mochila (knapsack):
maximizar cuánto del presupuesto se usa sin pasarse. Se resuelve con programación dinámica exacta
y determinística — mismo catálogo y mismo presupuesto dan siempre el mismo resultado. Pedirle esto
a un LLM sería arriesgar la única promesa que no puede fallar (no pasarse del presupuesto) a cambio
de nada: no hay ambigüedad que resolver, es matemática pura. La IA entra donde sí hace falta:
 entender el pedido en lenguaje natural — nunca calculando el total ni inventando datos comerciales.

**n8n no puede `require()` el código del repo desde un Code node.** El Code node de n8n corre en
un sandbox: solo puede importar paquetes npm instalados dentro de la carpeta de n8n y habilitados
por una variable de entorno (`NODE_FUNCTION_ALLOW_EXTERNAL`), no rutas locales de otro proyecto.
La forma real de conectarlos es que n8n **orqueste** y llame a una API por HTTP — que es,
además, la arquitectura correcta si más adelante n8n también tiene que hablar con Tiendanube o
cualquier otro sistema externo.

## Arrancar

Necesitás Node 22+.

```bash
npm install
npm run build
```

Para probar la aplicación completa desde un único origen:

```bash
npm run dev:api    # API en :3001
```

Abrí `http://localhost:3001`. El backend sirve también la landing, por lo que no necesita CORS.

Si querés servir el frontend separado con `npm run dev:web`, indicá la API mediante el parámetro
de desarrollo `?api=http://localhost:3001`. En producción ese parámetro no es necesario:
`VITE_API_URL` se incorpora durante el build de Vercel.

## Variables de entorno

El proveedor predeterminado es Carrefour/VTEX y no requiere credenciales:

```bash
ECOMMERCE_PROVIDER=vtex
```

La API consulta `https://www.carrefour.com.ar/api/catalog_system/pub/products/search/{search}`.
La preferencia explícita se usa como búsqueda; sin preferencia se busca la categoría. Si VTEX
devuelve un error o no responde, el sistema usa automáticamente `packages/api/src/data/catalog.json`.

Para trabajar siempre con el catálogo histórico:

```bash
ECOMMERCE_PROVIDER=local
```

Para usar la integración demostrativa de solo lectura con las páginas públicas de Lenaldi:

```bash
ECOMMERCE_PROVIDER=lenaldi
LENALDI_CACHE_TTL_SECONDS=900
LENALDI_WHATSAPP_NUMBER=
```

Este proveedor consulta una vez por ciclo de caché las páginas públicas de Adidas, New Balance,
Nike, Puma y Vans alojadas en Google Sites. Normaliza únicamente nombre, marca, precio, imagen,
URL de origen y el enlace público “Hace tu pedido” cuando existe. No interpreta el ID interno como
SKU y no inventa stock, talles, promociones ni señales de calidad. Si Google Sites rechaza o demora
la consulta, el adaptador usa la última copia disponible en memoria o el fallback local existente.
La demostración no implica una asociación comercial oficial con Lenaldi.

`GEMINI_API_KEY` sigue siendo opcional. Sin ella, el sistema usa `StubIntentParser` y
`StubExplainer`, conservando el cálculo determinístico.

Cuando frontend y backend se publican por separado se usan estas variables adicionales:

```bash
# Backend: origen público exacto de Vercel (admite una lista separada por comas)
FRONTEND_ORIGIN=https://smart-bundle-ai.vercel.app

# Frontend: URL pública del Web Service de Render, sin barra final
VITE_API_URL=https://smart-bundle-ai-api.onrender.com
```

`VITE_API_URL` es pública y solo contiene la dirección de la API. `GEMINI_API_KEY` nunca forma
parte del build del frontend. Los orígenes `http://localhost` y `http://127.0.0.1` permanecen
habilitados para desarrollo.

## Publicación: Render + Vercel + Google Sites

El orden de publicación es backend primero y frontend después:

1. En Render crear un **Web Service** desde la raíz del repositorio. Usar
   `npm ci && npm run build:api` como Build Command y
   `npm start --workspace=@sba/api` como Start Command. Configurar `/health` como Health Check.
2. Cargar en Render `ECOMMERCE_PROVIDER=lenaldi`, `GEMINI_API_KEY`,
   `LENALDI_WHATSAPP_NUMBER=5491178236492`, `LENALDI_CACHE_TTL_SECONDS=900` y temporalmente
   `FRONTEND_ORIGIN=http://localhost:5500`. Render define `PORT`; no hay que fijarlo manualmente.
3. Copiar la URL HTTPS generada por Render.
4. En Vercel importar la raíz del repositorio, elegir preset **Other**, ejecutar
   `npm run build:web` y publicar `dist/web`. Crear `VITE_API_URL` con la URL copiada de Render.
5. Copiar la URL de producción de Vercel, reemplazar `FRONTEND_ORIGIN` en Render por esa URL exacta
   y reiniciar el servicio. Probar `/health`, una recomendación y el traspaso a WhatsApp.

La URL de Vercel es la que debe vincularse desde el botón de Google Sites. También se puede probar
**Insertar → Incorporar → URL**; el botón enlazado sigue siendo la alternativa más compatible con
Google Sites.

## Probar la sustitución

En modo `ECOMMERCE_PROVIDER=local`, el catálogo de prueba tiene a propósito dos productos sin
stock con un reemplazo real disponible: "Detergente Ala 750ml" (reemplazado por "Detergente Skip
900ml") y "Perfume mini 30ml" (reemplazado por otra fragancia). En la web, escribí "detergente" en
el campo de producto puntual y vas a ver la sustitución explicada.

## Motor de decision y politicas demo

`POST /bundle` acepta `strategy` con uno de estos valores: `lowest-cost`, `balanced`,
`quality-first` o `maximize-budget`. El motor cubre primero la necesidad principal y sus slots
complementarios; el precio utilizado queda como desempate, salvo cuando la estrategia elegida lo
convierte explicitamente en objetivo.

Las senales `qualityScore` y `valueScore` son opcionales. VTEX no las inventa: quedan ausentes si el
retailer no las publica. Los productos agregados a `catalog.json` para lavar ropa si incluyen esas
senales y sus nombres indican `Demo`; existen unicamente para demostrar decisiones diferenciadas.
Lenaldi tampoco publica una señal explícita de calidad; por eso `quality-first` conserva la decisión
equilibrada e informa que esa estrategia no puede evaluarse con los datos reales del sitio.

La API aplica `Politicas comerciales de demostracion`: beneficio maximo del 5%, minimo tres
productos, sin acumularlo sobre productos que ya tengan promocion del ecommerce y sin aplicarlo a
la categoria tecnologia. La respuesta separa subtotal observado, ahorro del ecommerce, beneficio
Smart Bundle demo, total final y presupuesto restante. Estas reglas no representan politicas reales
de Carrefour ni informacion de margen.

## Tests

```bash
npm test                              # core, sin servidor levantado
npm run test --workspace=@sba/api     # API, contra un servidor efímero en memoria
```

## Qué NO hace este prototipo

- El catálogo principal de la demo se consulta desde Carrefour/VTEX; el JSON local es fallback.
- No hay checkout ni carrito real — el resultado es una lista para copiar, no un link de compra.
- No hay autenticación ni multi-tienda.

## n8n

`n8n/smart-bundle-workflow.json` es el export real de un workflow que armé, publiqué y probé en una
instancia local de n8n (`npx n8n`) — no un JSON escrito a mano sin verificar. Tres nodos:

```
Webhook (POST /webhook/smart-bundle)  →  HTTP Request (POST a la API)  →  Respond to Webhook
```

Verificado end-to-end con un `curl` real contra el webhook de producción, con la API corriendo en
paralelo — `n8n` orquestó la llamada de punta a punta y devolvió el combo armado por `core`.

**Para importarlo:**

```bash
npx n8n import:workflow --input=n8n/smart-bundle-workflow.json
npx n8n start
```

Abrí el editor, activá el workflow ("Publish"), y con la API corriendo en `:3001` pegale al webhook:

```bash
curl -X POST http://localhost:5678/webhook/smart-bundle   -H "Content-Type: application/json"   -d '{"freeText":"necesito limpieza, tengo $4000"}'
```

Para que la web use este camino en vez de llamar a la API directo, cambiá la constante `ENDPOINT`
en `packages/web/app.js` por la URL del webhook.
