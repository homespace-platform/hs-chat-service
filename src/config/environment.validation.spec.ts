import 'reflect-metadata';
import { validateEnvironment } from './environment.validation';

describe('validateEnvironment', () => {
  it('fails fast when MONGODB_URI is missing', () => {
    expect(() => validateEnvironment({})).toThrow(
      'Invalid environment configuration',
    );
  });

  it('accepts configuration supplied through the environment', () => {
    const config = validateEnvironment({
      PORT: '8082',
      MONGODB_URI: 'mongodb://database.example/homespace_chat',
    });

    expect(config.MONGODB_URI).toBe(
      'mongodb://database.example/homespace_chat',
    );
    expect(config.PORT).toBe(8082);
  });
});
