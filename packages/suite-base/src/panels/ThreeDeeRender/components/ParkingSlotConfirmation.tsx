import { Paper, Button, Typography, Box } from '@mui/material';
import { styled } from '@mui/material/styles';

const ConfirmationPaper = styled(Paper)(({ theme }) => ({
  position: 'absolute',
  bottom: 20,
  right: 20,
  zIndex: 1001,
  backgroundColor: 'rgba(0, 0, 0, 0.7)',
  padding: theme.spacing(2),
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(2),
  backdropFilter: 'blur(4px)',
  boxShadow: theme.shadows[4],
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: theme.shape.borderRadius,
}));

const StyledButton = styled(Button)(({}) => ({
  minWidth: 'auto',
  fontWeight: 'bold',
}));

type ParkingSlotConfirmationProps = {
  onCancel: () => void;
  onConfirm: () => void;
};

export function ParkingSlotConfirmation({ onCancel, onConfirm }: ParkingSlotConfirmationProps) {
  return (
    <ConfirmationPaper elevation={6}>
      <Typography variant="body2" color="white">
        把车位拖动到期望的位置
      </Typography>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <StyledButton
          variant="contained"
          color="error"
          onClick={onCancel}
          size="small"
        >
          取消
        </StyledButton>
        <StyledButton
          variant="contained"
          color="success"
          onClick={onConfirm}
          size="small"
        >
          确认
        </StyledButton>
      </Box>
    </ConfirmationPaper>
  );
}
