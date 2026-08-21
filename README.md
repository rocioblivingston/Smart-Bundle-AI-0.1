# Smart Bundle AI — prototipo

A partir de la idea de Gaby ("Smart Bundle Optimizer for E-commerce"): el comprador dice qué
necesita y cuánto tiene para gastar, el sistema arma el combo que más aprovecha ese presupuesto
sin pasarse ni un peso, y si algo no tiene stock lo reemplaza por un producto equivalente.

## Cómo está armado

```
packages/
├─ core/    lógica de negocio pura — sin Express, sin n8n, sin SDK de Claude
├─ api/     servidor HTTP, adaptador Carrefour/VTEX y fallback local
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
entender el pedido en lenguaje natural y redactar la explicación — nunca calculando el total.

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
npm run build:api
```

Después, dos terminales:

```bash
npm run dev:api    # API en :3001
npm run dev:web    # web en :5500 (o abrí packages/web/index.html con Live Server)
```

Abrí `http://localhost:5500`.

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

`ANTHROPIC_API_KEY` sigue siendo opcional. Sin ella, el sistema usa `StubIntentParser` y
`StubExplainer`, conservando el cálculo determinístico.

## Probar la sustitución

En modo `ECOMMERCE_PROVIDER=local`, el catálogo de prueba tiene a propósito dos productos sin
stock con un reemplazo real disponible: "Detergente Ala 750ml" (reemplazado por "Detergente Skip
900ml") y "Perfume mini 30ml" (reemplazado por otra fragancia). En la web, escribí "detergente" en
el campo de producto puntual y vas a ver la sustitución explicada.

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
