import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

// Barreira rápida (borda): exige cookie de sessão válido nas rotas do painel.
// A autorização por perfil e a revalidação do usuário no banco acontecem no servidor (layout/actions/rotas).
export async function middleware(req: NextRequest) {
  const token = req.cookies.get("anx_session")?.value;
  const secret = process.env.AUTH_SECRET;
  let valid = false;
  if (token && secret) {
    try {
      await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ["HS256"] });
      valid = true;
    } catch {
      valid = false;
    }
  }
  if (!valid) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/painel/:path*"] };
