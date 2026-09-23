import { createServer } from 'node:http'
import { createApp } from './app.js'
import { CollaborationServer } from './collaboration.js'
import { PostgresOperationStore } from './store.js'

const port = Number(process.env.PORT ?? 3000)
const httpServer = createServer(createApp())
const store = new PostgresOperationStore()
const collaboration = new CollaborationServer(httpServer, store)

const start = async (): Promise<void> => {
  await store.initialize()
  httpServer.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`)
  })
}

void start().catch(async (error: unknown) => {
  console.error('Failed to initialize PostgreSQL persistence', error)
  await collaboration.close()
  process.exitCode = 1
})
