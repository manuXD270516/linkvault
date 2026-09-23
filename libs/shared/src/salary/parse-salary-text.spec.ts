import { describe, expect, it } from 'vitest';
import {
  PARSE_SALARY_TEXT_EXTRACTOR,
  parseAmountToken,
  parseSalaryText,
} from './parse-salary-text';
import { previewExtractorIdSchema } from '../schemas/preview.schema';

describe('PARSE_SALARY_TEXT_EXTRACTOR', () => {
  it('fits previewExtractorIdSchema', () => {
    expect(previewExtractorIdSchema.parse(PARSE_SALARY_TEXT_EXTRACTOR)).toBe(
      'parse-salary-text',
    );
  });
});

describe('parseAmountToken', () => {
  it('reads US thousands with comma', () => {
    expect(parseAmountToken('3,000')).toBe(3000);
  });

  it('reads LatAm thousands with dot', () => {
    expect(parseAmountToken('3.500')).toBe(3500);
  });

  it('reads plain integers', () => {
    expect(parseAmountToken('8500')).toBe(8500);
  });

  it('reads decimals with 1–2 fraction digits', () => {
    expect(parseAmountToken('3.5')).toBe(3.5);
    expect(parseAmountToken('3,50')).toBe(3.5);
  });

  it('reads mixed separators (US / EU)', () => {
    expect(parseAmountToken('1,234.56')).toBe(1234.56);
    expect(parseAmountToken('1.234,56')).toBe(1234.56);
  });

  it('rejects ambiguous long fraction after one sep', () => {
    expect(parseAmountToken('1.2345')).toBeNull();
  });
});

describe('parseSalaryText', () => {
  it('parses USD monthly range', () => {
    expect(parseSalaryText('USD 3,000 - 5,000 / month')).toEqual({
      min: 3000,
      max: 5000,
      currency: 'USD',
      period: 'month',
    });
  });

  it('parses single Bs amount with salary word', () => {
    expect(parseSalaryText('Sueldo: Bs. 8500 mensuales')).toEqual({
      min: 8500,
      max: 8500,
      currency: 'BOB',
      period: 'month',
    });
  });

  it('parses LatAm thousands with salary word', () => {
    expect(parseSalaryText('Salario Bs. 3.500 mensuales')).toEqual({
      min: 3500,
      max: 3500,
      currency: 'BOB',
      period: 'month',
    });
  });

  it('parses from-to with dollar and period', () => {
    expect(parseSalaryText('from $4000 to $6000 per month')).toEqual({
      min: 4000,
      max: 6000,
      currency: 'USD',
      period: 'month',
    });
  });

  it('parses en-dash range', () => {
    expect(parseSalaryText('Salario USD 2000–3000 monthly')).toEqual({
      min: 2000,
      max: 3000,
      currency: 'USD',
      period: 'month',
    });
  });

  it('parses "N a M" range', () => {
    expect(parseSalaryText('Sueldo 4000 a 6000 Bs. mensuales')).toEqual({
      min: 4000,
      max: 6000,
      currency: 'BOB',
      period: 'month',
    });
  });

  it('detects year and hour periods', () => {
    expect(parseSalaryText('Salary $80,000 / year')).toMatchObject({
      min: 80000,
      max: 80000,
      currency: 'USD',
      period: 'year',
    });
    expect(parseSalaryText('Salario $25 / hour')).toMatchObject({
      min: 25,
      max: 25,
      currency: 'USD',
      period: 'hour',
    });
  });

  it('returns null without salary anchor', () => {
    expect(parseSalaryText('5 años de experiencia en ventas')).toBeNull();
  });

  it('returns null for Node $ without period', () => {
    expect(parseSalaryText('Experiencia en Node $ y React')).toBeNull();
  });

  it('returns null for bare numbers without currency or salary word', () => {
    expect(parseSalaryText('Entre 3000 y 5000 según perfil')).toBeNull();
  });

  it('returns null for empty / whitespace', () => {
    expect(parseSalaryText('')).toBeNull();
    expect(parseSalaryText('   ')).toBeNull();
  });

  it('does not invent a range from two loose amounts', () => {
    expect(
      parseSalaryText('Salario 3000. También bono 500 mensuales'),
    ).toBeNull();
  });

  it('currency+period anchor without salary word', () => {
    expect(parseSalaryText('USD 4500 monthly')).toEqual({
      min: 4500,
      max: 4500,
      currency: 'USD',
      period: 'month',
    });
  });
});
