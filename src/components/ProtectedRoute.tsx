import React from "react";
import { useEffect } from "react";
import { useLocation } from "@tanstack/react-router";
import { useAuth } from "./AuthProvider";

export function ProtectedRoute({ children, roles }: { children: React.ReactNode, roles?: string[] }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  const isAllowed = (u: { role: string; internalRole?: string | null }) => {
    if (!roles) return true;
    if (roles.includes(u.role)) return true;
    if (u.internalRole && roles.includes(u.internalRole)) return true;
    return false;
  };

  useEffect(() => {
    if (isLoading) return;
    if (!user && location.pathname !== "/login") {
      window.location.replace(`/login?returnTo=${encodeURIComponent(location.pathname)}`);
      return;
    }
    if (user && !isAllowed(user)) {
      window.location.replace("/dashboard");
    }
  }, [isLoading, location.pathname, roles, user]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (!isAllowed(user)) {
    return null;
  }

  return <>{children}</>;
}
