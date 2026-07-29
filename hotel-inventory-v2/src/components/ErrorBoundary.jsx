import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // A failed dynamic import means a new version shipped while this tab was
      // open. App.jsx already retries and reloads; if it still reaches here, say
      // what actually happened rather than calling it an unexpected error — the
      // work is not lost and the fix is just a reload.
      const message = this.state.error?.message || '';
      const isStaleBuild = /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(message);

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
          <div className="bg-white rounded-xl shadow-lg p-8 max-w-md text-center">
            <div className={`w-16 h-16 ${isStaleBuild ? 'bg-blue-100' : 'bg-red-100'} rounded-full flex items-center justify-center mx-auto mb-4`}>
              {isStaleBuild ? (
                <svg className="w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              ) : (
                <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              )}
            </div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">
              {isStaleBuild ? 'Versi Baru Tersedia' : 'Terjadi Kesalahan'}
            </h2>
            <p className="text-gray-600 mb-4">
              {isStaleBuild
                ? 'Aplikasi baru saja diperbarui sementara halaman ini terbuka. Klik tombol di bawah untuk memuat versi terbaru. Data Anda aman.'
                : 'Aplikasi mengalami error yang tidak terduga. Silakan reload halaman.'}
            </p>
            {!isStaleBuild && (
              <p className="text-xs text-gray-400 mb-4 font-mono break-all">
                {message || 'Unknown error'}
              </p>
            )}
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              {isStaleBuild ? 'Muat Versi Terbaru' : 'Reload Halaman'}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
