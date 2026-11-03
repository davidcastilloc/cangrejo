export {
  MtgjSchemaValidator,
  type MtgjCollectionNodeJson,
  type MtgjDocumentJson,
  type MtgjEncryptionMetadataJson,
  type MtgjEntityJson,
  type MtgjLinkJson,
  type MtgjPropertyJson,
  type ValidationOutcome,
} from './MtgjSchemaValidator.js';

export {
  CgrjDocumentSchema,
  CgrjEncryptionEnvelopeSchema,
  CgrjEntitySchema,
  CgrjLinkSchema,
  CgrjPropertySchema,
  PesquisaEntityItemSchema,
  PesquisaRunResponseSchema,
  validateCgrjWithZod,
} from './ZodContracts.js';
