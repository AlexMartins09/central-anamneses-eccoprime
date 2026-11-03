import { z } from "zod";
import { DATE_KEY_RE } from "./time";

export const passwordSchema = z
  .string()
  .min(10, "A senha deve ter ao menos 10 caracteres")
  .max(200)
  .regex(/[a-z]/, "Inclua uma letra minúscula")
  .regex(/[A-Z]/, "Inclua uma letra maiúscula")
  .regex(/\d/, "Inclua um número");

export const nameSchema = (label: string) =>
  z
    .string()
    .trim()
    .min(5, `Informe o ${label} completo`)
    .max(120)
    .refine((v) => v.split(/\s+/).filter(Boolean).length >= 2, `Informe nome e sobrenome do ${label}`)
    .refine((v) => !/[<>{}\[\]\\/@#$%^*=+|~`]/.test(v), "Caracteres inválidos");

export const emailSchema = z.string().trim().toLowerCase().email("E-mail inválido").max(200);

/** Telefone brasileiro com DDD (10 ou 11 dígitos). Armazenado como dígitos. */
export const phoneSchema = z
  .string()
  .transform((v) => v.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, ""))
  .refine((v) => /^[1-9]{2}9?\d{8}$/.test(v), "Informe DDD + número (ex.: 81 99999-0000)");

export const dateKeySchema = z.string().regex(DATE_KEY_RE, "Data inválida");
export const idSchema = z.string().min(1).max(40);
