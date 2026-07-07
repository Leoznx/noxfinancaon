import { Component, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  nome?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  
  componentDidCatch(error: Error, info: any) {
    console.error('[ErrorBoundary] Erro capturado:', error, info);
  }
  
  reset = () => {
    this.setState({ hasError: false, error: null });
  };
  
  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 m-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" strokeWidth={1.5} />
            <div className="flex-1">
              <h3 className="font-semibold text-red-900 mb-1">
                Não foi possível carregar {this.props.nome || 'esta seção'}
              </h3>
              <p className="text-sm text-red-700 mb-3">
                {this.state.error?.message || 'Erro inesperado. Tente recarregar.'}
              </p>
              <div className="flex gap-2">
                <button 
                  onClick={this.reset}
                  className="text-sm bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-medium inline-flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" strokeWidth={2} />
                  Tentar novamente
                </button>
                <button 
                  onClick={() => window.location.href = '/dashboard'}
                  className="text-sm border border-red-200 hover:bg-red-100 text-red-700 px-4 py-2 rounded-lg font-medium"
                >
                  Voltar ao painel
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
