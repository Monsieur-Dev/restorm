import React from 'react'

interface LoadingScreenProps {
  logoSrc?: string
}

const LoadingScreen: React.FC<LoadingScreenProps> = ({ 
  logoSrc = '/imgs/logo_400.png' 
}) => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        width: '100vw',
        backgroundColor: '#1a1a2e',
        position: 'fixed',
        top: 0,
        left: 0,
        zIndex: 9999
      }}
    >
      <img
        src={logoSrc}
        alt="Restorm"
        style={{
          width: '200px',
          height: 'auto',
          animation: 'pulse 2s ease-in-out infinite'
        }}
      />
      <style>
        {`
          @keyframes pulse {
            0%, 100% {
              opacity: 1;
              transform: scale(1);
            }
            50% {
              opacity: 0.8;
              transform: scale(0.98);
            }
          }
        `}
      </style>
    </div>
  )
}

export default LoadingScreen
