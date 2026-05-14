import { Router } from 'express';
import organizationsRouter from './organizations.router';
import contactsRouter from './contacts.router';
import dealsRouter from './deals.router';

const router = Router();

router.use('/organizations', organizationsRouter);
router.use('/contacts', contactsRouter);
router.use('/deals', dealsRouter);

export default router;
