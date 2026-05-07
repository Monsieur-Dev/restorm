import React from 'react'
import { RequestCreationContext, type RequestCreationApi } from './requestCreationContextValue'

export const RequestCreationProvider: React.FC<{ value: RequestCreationApi; children: React.ReactNode }> = ({ value, children }) => {
  return (
    <RequestCreationContext.Provider value={value}>
      {children}
    </RequestCreationContext.Provider>
  )
}
