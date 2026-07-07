import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Search, 
  Filter, 
  Download, 
  Mail, 
  Phone, 
  ExternalLink, 
  UserRound, 
  Building2, 
  Home,
  Clock,
  MoreVertical
} from "lucide-react";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/admin/leads")({
  component: () => (
    <ProtectedRoute>
      <LeadsAdminPage />
    </ProtectedRoute>
  ),
});

function LeadsAdminPage() {
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterProfile, setFilterProfile] = useState<string>("todos");
  const [searchTerm, setSearchTerm] = useState("");

  const fetchLeads = async () => {
    setLoading(true);
    let query = supabase
      .from('leads_contato')
      .select('*')
      .order('created_at', { ascending: false });

    if (filterProfile !== "todos") {
      query = query.eq('perfil', filterProfile);
    }

    const { data, error } = await query;

    if (error) {
      console.error(error);
      toast.error("Erro ao carregar leads");
    } else {
      setLeads(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchLeads();
  }, [filterProfile]);

  const updateStatus = async (id: string, newStatus: string) => {
    const { error } = await supabase
      .from('leads_contato')
      .update({ status: newStatus })
      .eq('id', id);

    if (error) {
      toast.error("Erro ao atualizar status");
    } else {
      toast.success("Status atualizado");
      fetchLeads();
    }
  };

  const filteredLeads = leads.filter(lead => 
    lead.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
    lead.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    lead.cidade.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'novo': return <Badge className="bg-blue-100 text-blue-700 border-blue-200">Novo</Badge>;
      case 'em_contato': return <Badge className="bg-amber-100 text-amber-700 border-amber-200">Em Contato</Badge>;
      case 'qualificado': return <Badge className="bg-purple-100 text-purple-700 border-purple-200">Qualificado</Badge>;
      case 'convertido': return <Badge className="bg-green-100 text-green-700 border-green-200">Convertido</Badge>;
      case 'descartado': return <Badge className="bg-neutral-100 text-neutral-500 border-neutral-200">Descartado</Badge>;
      default: return <Badge>{status}</Badge>;
    }
  };

  const getProfileIcon = (perfil: string) => {
    switch (perfil) {
      case 'corretor': return <UserRound className="w-4 h-4 text-yellow-600" />;
      case 'imobiliaria': return <Building2 className="w-4 h-4 text-yellow-600" />;
      case 'proprietario': return <Home className="w-4 h-4 text-yellow-600" />;
      default: return null;
    }
  };

  const exportCSV = () => {
    const headers = ["ID", "Nome", "E-mail", "Telefone", "Perfil", "Cidade", "UF", "Status", "Data"];
    const rows = filteredLeads.map(l => [
      l.id, l.nome, l.email, l.telefone, l.perfil, l.cidade, l.uf, l.status, new Date(l.created_at).toLocaleDateString()
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers, ...rows].map(e => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `leads_nox_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <h1 className="text-3xl font-bold text-neutral-900 tracking-tight">Gestão de Leads</h1>
            <p className="text-neutral-500 mt-2 font-medium">Acompanhe e gerencie os novos contatos recebidos pelas landings.</p>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={exportCSV} className="gap-2 h-11">
              <Download size={18} />
              Exportar CSV
            </Button>
          </div>
        </div>

        <div className="bg-white p-6 border border-neutral-200 rounded-xl shadow-sm space-y-6">
          <div className="flex flex-col md:flex-row gap-4 justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-3 text-neutral-400" size={18} />
              <Input 
                placeholder="Buscar por nome, e-mail ou cidade..." 
                className="pl-10 h-11"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-2">
              <Filter size={18} className="text-neutral-400 mr-2" />
              <Select value={filterProfile} onValueChange={setFilterProfile}>
                <SelectTrigger className="w-[180px] h-11">
                  <SelectValue placeholder="Todos os perfis" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os perfis</SelectItem>
                  <SelectItem value="corretor">Corretores</SelectItem>
                  <SelectItem value="imobiliaria">Imobiliárias</SelectItem>
                  <SelectItem value="proprietario">Proprietários</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex gap-2 mb-4">
            <Button variant={filterProfile === "todos" ? "default" : "outline"} onClick={() => setFilterProfile("todos")}>Todos</Button>
            <Button variant={filterProfile === "corretor" ? "default" : "outline"} onClick={() => setFilterProfile("corretor")}>Corretores</Button>
            <Button variant={filterProfile === "imobiliaria" ? "default" : "outline"} onClick={() => setFilterProfile("imobiliaria")}>Imobiliárias</Button>
            <Button variant={filterProfile === "proprietario" ? "default" : "outline"} onClick={() => setFilterProfile("proprietario")}>Proprietários</Button>
          </div>

            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader className="bg-neutral-50">
                  <TableRow>
                    <TableHead>Lead</TableHead>
                    <TableHead>Perfil</TableHead>
                    <TableHead>Localização</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-20 text-neutral-400 font-medium">
                        <Clock className="w-6 h-6 animate-spin mx-auto mb-2 opacity-20" />
                        Carregando leads...
                      </TableCell>
                    </TableRow>
                  ) : filteredLeads.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-20 text-neutral-400 font-medium">Nenhum lead encontrado.</TableCell>
                    </TableRow>
                  ) : filteredLeads.map((lead) => (
                    <TableRow key={lead.id} className="hover:bg-neutral-50/50 transition-colors">
                      <TableCell className="py-4">
                        <div className="flex flex-col">
                          <span className="font-bold text-neutral-900">{lead.nome}</span>
                          <span className="text-xs text-neutral-500">{lead.email}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="bg-yellow-50 p-1.5 rounded-md border border-yellow-100">
                            {getProfileIcon(lead.perfil)}
                          </div>
                          <span className="text-xs font-bold uppercase tracking-wider text-neutral-600">{lead.perfil}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-neutral-700">{lead.cidade}</span>
                          <span className="text-xs text-neutral-400 font-bold">{lead.uf}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger className="focus:outline-none">
                            {getStatusBadge(lead.status)}
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            <DropdownMenuItem onClick={() => updateStatus(lead.id, 'novo')}>Novo</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => updateStatus(lead.id, 'em_contato')}>Em Contato</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => updateStatus(lead.id, 'qualificado')}>Qualificado</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => updateStatus(lead.id, 'convertido')}>Convertido</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => updateStatus(lead.id, 'descartado')}>Descartado</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                      <TableCell className="text-xs text-neutral-500 font-medium">
                        {new Date(lead.created_at).toLocaleDateString('pt-BR')}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <a href={`mailto:${lead.email}`} title="Enviar E-mail">
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-neutral-400 hover:text-neutral-900">
                              <Mail size={16} />
                            </Button>
                          </a>
                          <a href={`https://wa.me/55${lead.telefone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" title="WhatsApp">
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-neutral-400 hover:text-green-600">
                              <Phone size={16} />
                            </Button>
                          </a>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="icon" variant="ghost" className="h-8 w-8">
                                <MoreVertical size={16} />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem className="gap-2">
                                <ExternalLink size={14} /> Ver detalhes
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-red-600 gap-2">
                                Excluir lead
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          
        </div>
      </div>
    </DashboardLayout>
  );
}
