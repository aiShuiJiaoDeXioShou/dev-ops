import { Type } from 'typebox'

export const healthResponseSchema = Type.Object({
  status: Type.Literal('ok'),
})

export const readinessResponseSchema = Type.Object({
  status: Type.Literal('ok'),
  database: Type.Literal('ok'),
})
