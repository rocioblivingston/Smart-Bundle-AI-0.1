# Cómo seguir vos con esto

Este repo arrancó como un prototipo que armamos para probar si tu idea de Smart Bundle AI
se sostiene técnicamente. La respuesta es: sí, con dos ajustes (están explicados en el
README y en el commit `fix(core): substitute must match product type...` — leélo, ahí está
el razonamiento). El núcleo del producto (`packages/core`) está construido, testeado y
funcionando.

**Lo que falta es tuyo: ponerlo online para que cualquiera lo pueda usar sin tener tu
computadora prendida.** Y ese paso, a propósito, no te lo resolví yo. Es la parte que más
se parece a un trabajo real, y es la que más se aprende haciéndola.

## Por qué no está ya deployado

Ahora mismo el front (`packages/web`) le habla a la API en `http://localhost:3001` —
literal, tu propia máquina. Andá a `packages/web/app.js` y vas a ver la constante
`ENDPOINT`. Mientras diga `localhost`, solo vos podés usar el combo, desde tu compu, con
todo corriendo a la vez.

## Lo que tenés que resolver (en este orden)

1. **Que la URL de la API no esté fija en el código.** Buscá cómo un sitio estático sabe a
   qué API pegarle según el entorno donde corre (local vs. producción) sin tener que tocar
   el código cada vez. No hay una sola forma correcta — investigá "runtime config static
   site" o mirá cómo lo resuelven ejemplos de proyectos chicos en Vercel o Netlify.

2. **Deployar la API en algún lado.** `packages/api` es un servidor Express normal.
   Necesita vivir en un servicio que corra Node de forma continua o bajo demanda —
   Vercel, Render y Railway son las opciones más simples y tienen plan gratuito. Cada uno
   tiene su forma de configurar "de dónde arranca" en un monorepo (buscá "root directory"
   en la doc del que elijas).

3. **La `ANTHROPIC_API_KEY` es opcional, y así debería seguir.** Si no la configurás en el
   servicio de deploy, el sistema sigue funcionando con las reglas fijas (`StubIntentParser`,
   `StubExplainer`) — no le pidas la key a nadie de Semillero, no hace falta para demostrar
   que el prototipo funciona.

4. **Después, deployar el front** apuntando a la URL real de la API que te dio el paso 2.

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
