import { z } from 'zod';

/** The longest question Ask takes (the input stops at it too). */
export const ASK_QUESTION_MAX = 500;

// Printable text: no control characters but line breaks.
const PRINTABLE = /^[^\p{Cc}]*$/u;

/** A question as POST /api/ask receives it (launch item i56). */
export const askQuestionSchema = z.object({
    question: z.string({ message: 'question must be text' })
        .transform((question) => question.replace(/\s+/g, ' ').trim())
        .pipe(z.string()
            .min(1, 'Ask a question')
            .max(ASK_QUESTION_MAX, `A question can be at most ${ASK_QUESTION_MAX} characters`)
            .regex(PRINTABLE, 'question must be printable text')),
}).strict();

export type AskQuestionInput = z.infer<typeof askQuestionSchema>;
