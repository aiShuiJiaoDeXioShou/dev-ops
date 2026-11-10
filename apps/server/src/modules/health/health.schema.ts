import { Type, type Static } from 'typebox'

const failureSchema = Type.Object({
  success: Type.Literal(false),
  code: Type.String(),
  message: Type.String(),
  requestId: Type.String(),
  data: Type.Optional(Type.Unknown()),
})

const successSchema = <T extends ReturnType<typeof Type.Object>>(data: T) =>
  Type.Object({
    success: Type.Literal(true),
    code: Type.Literal('OK'),
    message: Type.String(),
    requestId: Type.String(),
    data,
  })

export const healthResponseSchema = Type.Union([
  successSchema(Type.Object({ status: Type.Literal('ok') })),
  failureSchema,
])

export const readinessResponseSchema = Type.Union([
  successSchema(
    Type.Object({
      status: Type.Literal('ok'),
      database: Type.Literal('ok'),
    }),
  ),
  failureSchema,
])

export type HealthResponse = Static<typeof healthResponseSchema>
export type ReadinessResponse = Static<typeof readinessResponseSchema>
