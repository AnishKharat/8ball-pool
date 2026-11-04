import { createGameServer } from './server';

const port = Number(process.env.PORT) || 3000;
const { http } = createGameServer();
http.listen(port, () => console.log('listening on', port));
