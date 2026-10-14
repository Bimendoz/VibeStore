# VibeStore

Tienda-fachada con canal privado cifrado (chat de Luna y León).

## Baúl (nuevo)
Cada persona tiene su propio Baúl (ícono de cofre en la cabecera del chat). Lo que hay en tu Baúl es tuyo: solo tú lo ves y solo tú lo borras, aunque te lo haya dejado la otra persona.

- **Al enviar una foto** se elige: **Feed** (va a la conversación) o **Baúl de la otra persona**.
- Si te dejan una foto en el Baúl, al abrir el chat aparece el aviso "X te dejó una foto en el Baúl" y un punto naranja sobre el cofre.
- **Fotos del Feed** (mantener presionada una foto): *Copia a mi Baúl* (sigue en el chat), *Enviar a mi Baúl* (sale del chat y queda solo en tu Baúl), o *Enviar al Baúl de la otra persona*.
- Con **+** subes fotos del teléfono directo a tu Baúl.
- **Historial:** pestaña dentro del Baúl con todas las fotos que SIGUEN en el chat (también las antiguas). Con *Seleccionar* se eligen varias y se *Guardan en mi Baúl* o se *Envían al Baúl* de la otra persona. Lo que ya se borró del chat NO se puede recuperar.
- **PIN opcional** (candado): 4 números, se pide cada vez que se abre el Baúl. 5 intentos fallidos = esperar 60 s. Si se olvida, se borra en Firebase el nodo `chat/vaultPin/user_luna` (o `user_leon`).
- Las copias del Baúl son independientes del chat: si alguien borra el mensaje, la del Baúl sigue.
- Datos en Firebase: `chat/vault/`, `chat/vaultPin/` y `chat/vaultEvents/` (aviso para el servidor; se borra solo).


## Ajustes (v2)
- **Historial solo para León (admin):** Luna no ve la pestaña Historial ni puede recuperar; solo León. Luna sí tiene su Baúl: ve y borra lo que le enviaron.
- **Identidad visible:** el Baúl muestra "Baúl de León" / "Baúl de Luna". Para cambiar de usuario: menú del chat → "Cambiar de usuario" (vuelve a pedir el código y la identidad). Importante: el Baúl, el PIN y las notificaciones van atados al usuario; si entras con otra identidad verás otro Baúl.
- **PIN:** al abrir el Baúl se pide el PIN si está puesto; si no se puede leer aún, NO abre sin protección (falla cerrado).
- **Mi Baúl:** botón "Seleccionar" para elegir varias y Eliminar o Enviar al Baúl de la otra persona.

## Baul v3 (diseno + albumes)
- Rediseno del Baúl: tema oscuro propio de alto contraste, sin desenfoque y con mas espaciado.
- Albumes: en Mi Baúl hay chips Todo / Favoritos / tus albumes / + Album. Con Seleccionar marcas varias y usas Favorito, A album, Enviar o Eliminar. En el visor hay estrella (favorito) y carpeta (mover a album). Sirve para clasificar las fotos del Baúl.
- Notificaciones: se dejaron igual que en el VibeStore original (cada telefono suscrito a su identidad; el que envia no recibe). En dos telefonos, Leon recibe las de Luna y Luna las de Leon. Tras actualizar, abre la app una vez en cada telefono para re-suscribir.
- Reparar avisos: en el menu del chat (tres puntos) esta "Activar / reparar avisos". Fuerza una suscripcion nueva; usalo en el telefono al que NO le llegan.
