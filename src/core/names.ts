// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.

const DATA_EXTENSION = /\.(xlsx|xlsm|xlsb|xls|csv|tsv|txt|json|pdf)$/i;

/** Tidies a name typed by the person. The file type is added again when a file is downloaded. */
export function cleanName(input: string, fallback: string): string {
  const name = input.replace(/\s+/g, ' ').trim().replace(DATA_EXTENSION, '').trim().slice(0, 80).trim();
  return name || fallback;
}

/** True when another file already uses this name, ignoring capital letters. */
export const nameTaken = (name: string, others: string[]) => others.some((o) => o.trim().toLowerCase() === name.trim().toLowerCase());
