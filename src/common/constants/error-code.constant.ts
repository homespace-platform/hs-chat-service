export const ErrorCode = {
  UNCATEGORIZED_EXCEPTION: {
    code: 9999,
    message: 'Uncategorized error',
    statusCode: 500,
  },
  UNAUTHENTICATED: {
    code: 1002,
    message: 'Unauthenticated',
    statusCode: 401,
  },
  ROUTE_NOT_FOUND: {
    code: 1012,
    message: 'Route not found',
    statusCode: 404,
  },
} as const;
