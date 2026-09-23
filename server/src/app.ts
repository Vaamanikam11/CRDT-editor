import cors from 'cors'
import express from 'express'
import type { HealthResponse } from '@crdt-editor/shared'

export const createApp = (): express.Express => {
  const app = express()

  app.use(cors())
  app.use(express.json())

  app.get('/health', (_request, response) => {
    const payload: HealthResponse = {
      status: 'ok',
      service: 'server',
      timestamp: new Date().toISOString(),
    }

    response.json(payload)
  })

  return app
}
