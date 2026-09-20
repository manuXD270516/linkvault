import { type MatDialogRef } from '@angular/material/dialog';
import { MatDialog } from '@angular/material/dialog';
import {
  MATCH_DIALOG_SIZE,
  MatchDialog,
  type MatchDialogData,
  type MatchDialogResult,
} from './match.dialog';

/** Abre el diálogo de encaje (tarjeta de oferta, tarea 16.16). No pide análisis al abrirse. */
export function openMatchDialog(
  dialog: MatDialog,
  data: MatchDialogData,
): MatDialogRef<MatchDialog, MatchDialogResult> {
  return dialog.open<MatchDialog, MatchDialogData, MatchDialogResult>(MatchDialog, {
    ...MATCH_DIALOG_SIZE,
    data,
  });
}
