import React from 'react'

interface HttpMethodBadgeProps {
  method: string
}

const normalizeMethod = (method: string): string => method.toLowerCase()

export const HttpMethodBadge: React.FC<HttpMethodBadgeProps> = ({ method }) => {
  const normalized = normalizeMethod(method)
  const className = `http-method-badge http-method-badge--${normalized}`

  return <span className={className}>{method.toUpperCase()}</span>
}
